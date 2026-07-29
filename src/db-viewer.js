'use strict';
const net = require('net');
const crypto = require('crypto');
const { Client: PostgresClient } = require('pg');
const mysql = require('mysql2/promise');
const { MongoClient } = require('mongodb');

class DbViewer {
  constructor(downloadManager, configManager, serviceManager, secretStore = null) {
    this.downloadManager = downloadManager;
    this.configManager = configManager;
    this.serviceManager = serviceManager;
    this.secretStore = secretStore;
  }

  _assertSection(section) {
    if (!['postgresql', 'mysql', 'mariadb', 'mongodb'].includes(section)) throw new Error('Unsupported database type');
  }

  _assertDatabaseName(name, { strict = false } = {}) {
    if (typeof name !== 'string' || !name || name.length > 128 || name.includes('\0')) throw new Error('Invalid database name');
    if (strict && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('Invalid database name');
    return name;
  }

  _getActiveProfile(section) {
    const config = this.configManager.getConfig();
    const svc = config[section];
    if (!svc || !svc.profiles) return null;
    return svc.profiles.find(p => p.id === svc.activeProfileId) || svc.profiles[0] || null;
  }

  _normalizeConnection(input) {
    if (!input || typeof input !== 'object') throw new Error('Choose a database connection');
    const type = String(input.type || input.section || '').toLowerCase();
    this._assertSection(type);
    const host = String(input.host || '127.0.0.1').trim();
    if (!host || host.length > 253 || !/^[A-Za-z0-9._:[\]-]+$/.test(host)) throw new Error('Invalid database host');
    const defaults = { postgresql: 5432, mysql: 3306, mariadb: 3306, mongodb: 27017 };
    const port = Number(input.port || defaults[type]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid database port');
    const username = String(input.username || '').slice(0, 256);
    const password = String(input.password || '').slice(0, 4096);
    const name = String(input.name || `${type} ${host}:${port}`).trim().slice(0, 100);
    const ssl = Boolean(input.ssl);
    const rejectUnauthorized = input.rejectUnauthorized !== false;
    return { ...input, type, host, port, username, password, name, ssl, rejectUnauthorized };
  }

  _managedConnection(section) {
    const profile = this._getActiveProfile(section);
    if (!profile) return null;
    return this._normalizeConnection({
      id: `managed:${section}`, managed: true, section, type: section,
      name: `KitsuneServ ${section}`, host: profile.host || '127.0.0.1', port: profile.port,
      username: profile.username || '', password: profile.password || '', version: profile.version
    });
  }

  _storedConnections() {
    return this.configManager.getConfig().databaseManager?.connections || [];
  }

  _resolveConnection(input) {
    const id = typeof input === 'string' ? input : input?.id;
    let base = null;
    if (id?.startsWith('managed:')) base = this._managedConnection(id.slice('managed:'.length));
    else if (id) base = this._storedConnections().find(connection => connection.id === id) || null;
    const overrides = typeof input === 'object' ? input : {};
    const merged = { ...(base || {}), ...overrides };
    if (base?.password && !overrides.password) merged.password = base.password;
    if (!merged.password && id && this.secretStore) merged.password = this.secretStore.get(`database:${id}`);
    return this._normalizeConnection(merged);
  }

  async _withNativeConnection(input, database, action) {
    const connection = this._resolveConnection(input);
    if (database != null) this._assertDatabaseName(database);
    if (connection.type === 'postgresql') {
      const client = new PostgresClient({
        host: connection.host, port: connection.port,
        user: connection.username || 'postgres', password: connection.password || '',
        database: database || 'postgres', connectionTimeoutMillis: 5000,
        query_timeout: 30000, application_name: 'KitsuneServ',
        ssl: connection.ssl ? { rejectUnauthorized: connection.rejectUnauthorized } : false
      });
      await client.connect();
      try { return await action({ type: connection.type, client, connection }); }
      finally { await client.end().catch(() => {}); }
    }
    if (connection.type === 'mysql' || connection.type === 'mariadb') {
      const client = await mysql.createConnection({
        host: connection.host, port: connection.port,
        user: connection.username || 'root', password: connection.password || '',
        database: database || undefined, connectTimeout: 5000,
        enableKeepAlive: false, multipleStatements: false,
        ssl: connection.ssl ? { rejectUnauthorized: connection.rejectUnauthorized } : undefined
      });
      try { return await action({ type: connection.type, client, connection }); }
      finally { await client.end().catch(() => {}); }
    }
    const auth = connection.username
      ? `${encodeURIComponent(connection.username)}:${encodeURIComponent(connection.password || '')}@`
      : '';
    const tlsOptions = connection.ssl
      ? `&tls=true${connection.rejectUnauthorized ? '' : '&tlsAllowInvalidCertificates=true'}`
      : '';
    const uri = `mongodb://${auth}${connection.host}:${connection.port}/?authSource=admin${tlsOptions}`;
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, appName: 'KitsuneServ' });
    await client.connect();
    try { return await action({ type: connection.type, client, db: client.db(database || 'admin'), connection }); }
    finally { await client.close().catch(() => {}); }
  }

  _objectRows(rows) {
    if (!Array.isArray(rows) || !rows.length) return { columns: [], rows: [] };
    const columns = [...new Set(rows.flatMap(row => Object.keys(row || {})))];
    return {
      columns,
      rows: rows.map(row => columns.map(column => {
        const value = row?.[column];
        if (value == null) return '';
        if (Buffer.isBuffer(value)) return value.toString('hex');
        return typeof value === 'object' ? JSON.stringify(value) : String(value);
      }))
    };
  }

  _probe(host, port) {
    return new Promise(resolve => {
      const socket = net.createConnection({ host, port });
      const done = online => { socket.destroy(); resolve(online); };
      socket.setTimeout(350);
      socket.once('connect', () => done(true));
      socket.once('timeout', () => done(false));
      socket.once('error', () => done(false));
    });
  }

  async listConnections() {
    const managed = ['postgresql', 'mysql', 'mariadb', 'mongodb'].map(section => this._managedConnection(section)).filter(Boolean);
    const custom = this._storedConnections().map(connection => this._normalizeConnection(connection));
    const connections = [...managed, ...custom];
    await Promise.all(connections.map(async connection => { connection.online = await this._probe(connection.host, connection.port); }));
    const commonLocalEndpoints = [
      { type: 'postgresql', port: 5432 }, { type: 'postgresql', port: 5433 },
      { type: 'mysql', port: 3306 }, { type: 'mysql', port: 3307 },
      { type: 'mongodb', port: 27017 }, { type: 'mongodb', port: 27018 }
    ];
    await Promise.all(commonLocalEndpoints.map(async endpoint => {
      const exists = connections.some(connection => connection.type === endpoint.type
        && ['127.0.0.1', 'localhost'].includes(connection.host) && connection.port === endpoint.port);
      if (exists || !await this._probe('127.0.0.1', endpoint.port)) return;
      connections.push(this._normalizeConnection({
        id: `detected:${endpoint.type}:${endpoint.port}`, detected: true, online: true,
        name: `Detected ${endpoint.type}`, type: endpoint.type, host: '127.0.0.1', port: endpoint.port
      }));
    }));
    return connections.map(({ password, ...connection }) => ({ ...connection, hasSavedPassword: Boolean(password) || Boolean(connection.id && this.secretStore?.has(`database:${connection.id}`)) }));
  }

  saveConnection(input) {
    const connection = this._normalizeConnection(input);
    if (connection.id?.startsWith('managed:')) throw new Error('Managed connections are configured in their service profile');
    const config = this.configManager.getConfig();
    config.databaseManager = config.databaseManager || { connections: [] };
    const id = connection.id || `db-${crypto.randomUUID()}`;
    const stored = {
      id, name: connection.name, type: connection.type, host: connection.host,
      port: connection.port, username: connection.username,
      ssl: connection.ssl, rejectUnauthorized: connection.rejectUnauthorized
    };
    const index = config.databaseManager.connections.findIndex(item => item.id === id);
    if (index >= 0) config.databaseManager.connections[index] = stored;
    else config.databaseManager.connections.push(stored);
    const saved = this.configManager.saveConfig(config);
    if (!saved.success) throw new Error(saved.error);
    if (connection.password && this.secretStore) this.secretStore.set(`database:${id}`, connection.password);
    else if (input.clearPassword && this.secretStore) this.secretStore.remove(`database:${id}`);
    return { success: true, id };
  }

  removeConnection(id) {
    if (typeof id !== 'string' || !id.startsWith('db-')) throw new Error('Only custom connections can be removed');
    const config = this.configManager.getConfig();
    config.databaseManager.connections = (config.databaseManager?.connections || []).filter(item => item.id !== id);
    const saved = this.configManager.saveConfig(config);
    if (!saved.success) throw new Error(saved.error);
    this.secretStore?.remove(`database:${id}`);
    return { success: true };
  }

  async testConnection(connection) {
    const databases = await this.listDatabasesFor(connection);
    return { success: true, databases: databases.length };
  }

  async listDatabasesFor(input) {
    const connection = this._resolveConnection(input);
    return this._withNativeConnection(connection, connection.type === 'postgresql' ? 'postgres' : null, async context => {
      if (context.type === 'postgresql') {
        const result = await context.client.query('SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname');
        return result.rows.map(row => row.datname).filter(Boolean);
      }
      if (context.type === 'mysql' || context.type === 'mariadb') {
        const [rows] = await context.client.query('SHOW DATABASES');
        return rows.map(row => Object.values(row)[0]).filter(Boolean);
      }
      const result = await context.client.db('admin').admin().listDatabases();
      return result.databases.map(item => item.name).filter(Boolean).sort();
    });
  }

  async listTablesFor(input, database) {
    const connection = this._resolveConnection(input);
    return this._withNativeConnection(connection, database, async context => {
      if (context.type === 'postgresql') {
        const result = await context.client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
        return result.rows.map(row => row.tablename).filter(Boolean);
      }
      if (context.type === 'mysql' || context.type === 'mariadb') {
        const [rows] = await context.client.query('SHOW TABLES');
        return rows.map(row => Object.values(row)[0]).filter(Boolean);
      }
      const collections = await context.db.listCollections({}, { nameOnly: true }).toArray();
      return collections.map(item => item.name).sort();
    });
  }

  async executeQueryFor(input, database, query) {
    if (!query?.trim()) throw new Error('Empty query');
    if (query.length > 1024 * 1024) throw new Error('Query is too large');
    const connection = this._resolveConnection(input);
    return this._withNativeConnection(connection, database, async context => {
      if (context.type === 'postgresql') {
        const result = await context.client.query(query);
        const finalResult = Array.isArray(result) ? result[result.length - 1] : result;
        if (finalResult?.rows?.length) return this._objectRows(finalResult.rows);
        return { columns: [], rows: [], message: `Query executed successfully${Number.isInteger(finalResult?.rowCount) ? ` · ${finalResult.rowCount} affected` : ''}` };
      }
      if (context.type === 'mysql' || context.type === 'mariadb') {
        const [rows] = await context.client.query(query);
        if (Array.isArray(rows)) return this._objectRows(rows);
        const affected = Number(rows?.affectedRows || 0);
        return { columns: [], rows: [], message: `Query executed successfully · ${affected} affected` };
      }
      return this._executeMongoOperation(context.db, query);
    });
  }

  async _executeMongoOperation(database, query) {
    let operation;
    try { operation = JSON.parse(query); }
    catch { throw new Error('MongoDB queries in Database Manager use JSON. Choose a collection to insert a find template.'); }
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) throw new Error('MongoDB operation must be a JSON object');
    const action = String(operation.operation || (operation.command ? 'command' : 'find'));
    if (action === 'command') {
      if (!operation.command || typeof operation.command !== 'object') throw new Error('MongoDB command must be an object');
      return this._objectRows([await database.command(operation.command)]);
    }
    const collectionName = this._assertDatabaseName(operation.collection);
    const collection = database.collection(collectionName);
    const filter = operation.filter && typeof operation.filter === 'object' ? operation.filter : {};
    if (action === 'find') {
      const limit = Math.max(1, Math.min(1000, Number(operation.limit) || 100));
      const skip = Math.max(0, Number(operation.skip) || 0);
      let cursor = collection.find(filter, operation.projection ? { projection: operation.projection } : {});
      if (operation.sort && typeof operation.sort === 'object') cursor = cursor.sort(operation.sort);
      return this._objectRows(await cursor.skip(skip).limit(limit).toArray());
    }
    if (action === 'aggregate') {
      if (!Array.isArray(operation.pipeline)) throw new Error('MongoDB aggregate requires a pipeline array');
      return this._objectRows(await collection.aggregate(operation.pipeline, { maxTimeMS: 30000 }).limit(1000).toArray());
    }
    let result;
    if (action === 'insertOne') result = await collection.insertOne(operation.document || {});
    else if (action === 'insertMany') {
      if (!Array.isArray(operation.documents) || operation.documents.length > 1000) throw new Error('insertMany requires up to 1000 documents');
      result = await collection.insertMany(operation.documents);
    } else if (action === 'updateOne') result = await collection.updateOne(filter, operation.update || {}, { upsert: Boolean(operation.upsert) });
    else if (action === 'updateMany') result = await collection.updateMany(filter, operation.update || {}, { upsert: Boolean(operation.upsert) });
    else if (action === 'deleteOne') result = await collection.deleteOne(filter);
    else if (action === 'deleteMany') result = await collection.deleteMany(filter);
    else if (action === 'countDocuments') result = { count: await collection.countDocuments(filter) };
    else throw new Error(`Unsupported MongoDB operation: ${action}`);
    return this._objectRows([result]);
  }

  async createDatabaseFor(input, name) {
    const connection = this._resolveConnection(input);
    const safeName = this._assertDatabaseName(name, { strict: true });
    await this._withNativeConnection(connection, connection.type === 'postgresql' ? 'postgres' : null, async context => {
      if (context.type === 'postgresql') await context.client.query(`CREATE DATABASE "${safeName}"`);
      else if (context.type === 'mysql' || context.type === 'mariadb') await context.client.query(`CREATE DATABASE \`${safeName}\``);
      else await context.client.db(safeName).createCollection('_init');
    });
    return { success: true };
  }

  async dropDatabaseFor(input, name) {
    const connection = this._resolveConnection(input);
    const safeName = this._assertDatabaseName(name, { strict: true });
    await this._withNativeConnection(connection, connection.type === 'postgresql' ? 'postgres' : null, async context => {
      if (context.type === 'postgresql') await context.client.query(`DROP DATABASE IF EXISTS "${safeName}"`);
      else if (context.type === 'mysql' || context.type === 'mariadb') await context.client.query(`DROP DATABASE IF EXISTS \`${safeName}\``);
      else await context.client.db(safeName).dropDatabase();
    });
    return { success: true };
  }

  _assertManagedRunning(section) {
    this._assertSection(section);
    if (!this.serviceManager.getServiceStatus(section).running) throw new Error('Service is not running');
  }

  async listDatabases(section) {
    this._assertManagedRunning(section);
    return this.listDatabasesFor(`managed:${section}`);
  }

  async listTables(section, database) {
    this._assertManagedRunning(section);
    return this.listTablesFor(`managed:${section}`, database);
  }

  async tableData(section, database, table, limit = 100, offset = 0) {
    this._assertManagedRunning(section);
    if (typeof table !== 'string' || !table || table.length > 128 || table.includes('\0')) throw new Error('Invalid table name');
    const safeLimit = Math.max(1, Math.min(1000, parseInt(limit) || 100));
    const safeOffset = Math.max(0, parseInt(offset) || 0);
    const connection = this._managedConnection(section);
    return this._withNativeConnection(connection, database, async context => {
      if (context.type === 'postgresql') {
        const result = await context.client.query(`SELECT * FROM "${table.replace(/"/g, '""')}" LIMIT ${safeLimit} OFFSET ${safeOffset}`);
        return this._objectRows(result.rows);
      }
      if (context.type === 'mysql' || context.type === 'mariadb') {
        const [rows] = await context.client.query(`SELECT * FROM \`${table.replace(/`/g, '``')}\` LIMIT ${safeLimit} OFFSET ${safeOffset}`);
        return this._objectRows(rows);
      }
      return this._objectRows(await context.db.collection(table).find({}).skip(safeOffset).limit(safeLimit).toArray());
    });
  }

  async executeQuery(section, database, query) {
    this._assertManagedRunning(section);
    return this.executeQueryFor(`managed:${section}`, database, query);
  }

  async createDatabase(section, name) {
    this._assertManagedRunning(section);
    return this.createDatabaseFor(`managed:${section}`, name);
  }

  async dropDatabase(section, name) {
    this._assertManagedRunning(section);
    return this.dropDatabaseFor(`managed:${section}`, name);
  }
}

module.exports = DbViewer;
