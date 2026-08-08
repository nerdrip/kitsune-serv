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
    this.activeQueries = new Map();
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

  async listObjectsFor(input, database) {
    const connection = this._resolveConnection(input);
    return this._withNativeConnection(connection, database, async context => {
      let objects = [];
      if (context.type === 'postgresql') {
        const result = await context.client.query(`
          SELECT n.nspname AS "schemaName", c.relname AS name,
            CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'partitioned table'
              WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized view' WHEN 'f' THEN 'foreign table' ELSE 'object' END AS type,
            GREATEST(c.reltuples, 0)::bigint AS "estimatedRows",
            CASE WHEN c.relkind IN ('r','p','m') THEN pg_total_relation_size(c.oid) ELSE 0 END::bigint AS bytes
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relkind IN ('r','p','v','m','f')
            AND n.nspname NOT IN ('pg_catalog', 'information_schema')
            AND n.nspname NOT LIKE 'pg_toast%'
          ORDER BY n.nspname, c.relname`);
        objects = result.rows;
      } else if (context.type === 'mysql' || context.type === 'mariadb') {
        const [rows] = await context.client.execute(`
          SELECT TABLE_SCHEMA AS schemaName, TABLE_NAME AS name,
            CASE WHEN TABLE_TYPE = 'VIEW' THEN 'view' ELSE 'table' END AS type,
            COALESCE(TABLE_ROWS, 0) AS estimatedRows,
            COALESCE(DATA_LENGTH, 0) + COALESCE(INDEX_LENGTH, 0) AS bytes
          FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = ?
          ORDER BY TABLE_NAME`, [database]);
        objects = rows;
      } else {
        const collections = await context.db.listCollections({}, { nameOnly: false }).toArray();
        objects = collections.map(item => ({
          schemaName: database,
          name: item.name,
          type: item.type === 'view' ? 'view' : 'collection',
          estimatedRows: null,
          bytes: null
        }));
      }
      const schemas = new Map();
      for (const object of objects) {
        const schemaName = String(object.schemaName || database || 'default');
        if (!schemas.has(schemaName)) schemas.set(schemaName, { name: schemaName, objects: [] });
        schemas.get(schemaName).objects.push({
          name: String(object.name),
          type: String(object.type || 'table'),
          estimatedRows: object.estimatedRows == null ? null : Number(object.estimatedRows),
          bytes: object.bytes == null ? null : Number(object.bytes)
        });
      }
      return { database, schemas: [...schemas.values()] };
    });
  }

  async describeObjectFor(input, database, schema, objectName) {
    const connection = this._resolveConnection(input);
    const safeSchema = this._assertDatabaseName(schema || (connection.type === 'postgresql' ? 'public' : database));
    const safeObject = this._assertDatabaseName(objectName);
    return this._withNativeConnection(connection, database, async context => {
      if (context.type === 'postgresql') {
        const [columns, indexes, constraints] = await Promise.all([
          context.client.query(`
            SELECT column_name AS name,
              CASE WHEN data_type = 'USER-DEFINED' THEN udt_name ELSE data_type END AS "dataType",
              is_nullable = 'YES' AS nullable, column_default AS "defaultValue",
              character_maximum_length AS "maxLength", numeric_precision AS precision,
              ordinal_position AS position
            FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = $2
            ORDER BY ordinal_position`, [safeSchema, safeObject]),
          context.client.query(`SELECT indexname AS name, indexdef AS definition FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 ORDER BY indexname`, [safeSchema, safeObject]),
          context.client.query(`
            SELECT con.conname AS name,
              CASE con.contype WHEN 'p' THEN 'PRIMARY KEY' WHEN 'f' THEN 'FOREIGN KEY'
                WHEN 'u' THEN 'UNIQUE' WHEN 'c' THEN 'CHECK' ELSE con.contype::text END AS type,
              pg_get_constraintdef(con.oid, true) AS definition
            FROM pg_constraint con
            JOIN pg_class rel ON rel.oid = con.conrelid
            JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE nsp.nspname = $1 AND rel.relname = $2
            ORDER BY con.conname`, [safeSchema, safeObject])
        ]);
        return { database, schema: safeSchema, name: safeObject, type: 'object', columns: columns.rows, indexes: indexes.rows, constraints: constraints.rows };
      }
      if (context.type === 'mysql' || context.type === 'mariadb') {
        const [columnsResult, indexesResult, ddlResult] = await Promise.all([
          context.client.execute(`
            SELECT COLUMN_NAME AS name, COLUMN_TYPE AS dataType, IS_NULLABLE = 'YES' AS nullable,
              COLUMN_DEFAULT AS defaultValue, COLUMN_KEY AS columnKey, EXTRA AS extra,
              ORDINAL_POSITION AS position
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
            ORDER BY ORDINAL_POSITION`, [database, safeObject]),
          context.client.execute(`
            SELECT INDEX_NAME AS name, NON_UNIQUE = 0 AS uniqueIndex,
              GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ', ') AS columns,
              INDEX_TYPE AS indexType
            FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
            GROUP BY INDEX_NAME, NON_UNIQUE, INDEX_TYPE
            ORDER BY INDEX_NAME`, [database, safeObject]),
          context.client.query(`SHOW CREATE TABLE \`${safeObject.replace(/`/g, '``')}\``).catch(() => [[]])
        ]);
        const ddlRow = ddlResult[0]?.[0] || {};
        return {
          database, schema: database, name: safeObject, type: 'object',
          columns: columnsResult[0], indexes: indexesResult[0], constraints: [],
          ddl: ddlRow['Create Table'] || ddlRow['Create View'] || ''
        };
      }
      const collection = context.db.collection(safeObject);
      const [sample, indexes] = await Promise.all([
        collection.findOne({}),
        collection.indexes().catch(() => [])
      ]);
      let stats = {};
      try { stats = await context.db.command({ collStats: safeObject, scale: 1 }); } catch {}
      const columns = Object.entries(sample || {}).map(([name, value], position) => ({
        name,
        dataType: value === null ? 'null' : Array.isArray(value) ? 'array' : value instanceof Date ? 'date' : typeof value,
        nullable: true,
        defaultValue: null,
        position: position + 1
      }));
      return {
        database, schema: database, name: safeObject, type: 'collection', columns,
        indexes: indexes.map(index => ({ name: index.name, columns: Object.entries(index.key || {}).map(([key, direction]) => `${key} ${direction}`).join(', '), uniqueIndex: Boolean(index.unique), indexType: 'BSON' })),
        constraints: [],
        stats: { count: Number(stats.count || 0), size: Number(stats.size || 0), storageSize: Number(stats.storageSize || 0), totalIndexSize: Number(stats.totalIndexSize || 0) },
        sample: sample ? JSON.stringify(sample, null, 2) : ''
      };
    });
  }

  async tableDataFor(input, database, table, limit = 100, offset = 0, schema = '') {
    const connection = this._resolveConnection(input);
    const safeTable = this._assertDatabaseName(table);
    const safeLimit = Math.max(1, Math.min(1000, parseInt(limit) || 100));
    const safeOffset = Math.max(0, parseInt(offset) || 0);
    return this._withNativeConnection(connection, database, async context => {
      let result;
      if (context.type === 'postgresql') {
        const safeSchema = this._assertDatabaseName(schema || 'public');
        const rows = await context.client.query(`SELECT * FROM "${safeSchema.replace(/"/g, '""')}"."${safeTable.replace(/"/g, '""')}" LIMIT ${safeLimit} OFFSET ${safeOffset}`);
        result = this._objectRows(rows.rows);
      } else if (context.type === 'mysql' || context.type === 'mariadb') {
        const [rows] = await context.client.query(`SELECT * FROM \`${safeTable.replace(/`/g, '``')}\` LIMIT ${safeLimit} OFFSET ${safeOffset}`);
        result = this._objectRows(rows);
      } else {
        result = this._objectRows(await context.db.collection(safeTable).find({}).skip(safeOffset).limit(safeLimit).toArray());
      }
      return { ...result, limit: safeLimit, offset: safeOffset, hasMore: result.rows.length === safeLimit };
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

  _sqlWithoutLiterals(query) {
    let output = '';
    let quote = '';
    let lineComment = false;
    let blockComment = false;
    for (let index = 0; index < query.length; index += 1) {
      const character = query[index];
      const next = query[index + 1];
      if (lineComment) {
        if (character === '\n' || character === '\r') { lineComment = false; output += ' '; }
        continue;
      }
      if (blockComment) {
        if (character === '*' && next === '/') { blockComment = false; index += 1; }
        continue;
      }
      if (!quote && character === '-' && next === '-') { lineComment = true; index += 1; continue; }
      if (!quote && character === '/' && next === '*') { blockComment = true; index += 1; continue; }
      if (!quote && ['\'', '"', '`'].includes(character)) { quote = character; output += ' '; continue; }
      if (quote) {
        if (character === quote && next === quote) { index += 1; continue; }
        if (character === quote && query[index - 1] !== '\\') quote = '';
        continue;
      }
      output += character;
    }
    return output.replace(/\s+/g, ' ').trim().toLowerCase();
  }

  _assertReadOnlyQuery(type, query) {
    if (type === 'mongodb') {
      let operation;
      try { operation = JSON.parse(query); } catch { throw new Error('Read-only MongoDB operation must be valid JSON'); }
      const action = String(operation.operation || (operation.command ? 'command' : 'find'));
      if (!['find', 'aggregate', 'countDocuments'].includes(action)) throw new Error(`Read-only mode blocks MongoDB operation: ${action}`);
      return;
    }
    const sql = this._sqlWithoutLiterals(query);
    const first = sql.match(/^[a-z]+/)?.[0] || '';
    if (!['select', 'with', 'show', 'describe', 'desc', 'explain', 'values'].includes(first)) throw new Error(`Read-only mode blocks SQL statement: ${first || 'unknown'}`);
    if (/\b(insert|update|delete|merge|replace|upsert|create|alter|drop|truncate|grant|revoke|call|execute|copy|vacuum|reindex|cluster|refresh|lock|set)\b/.test(sql)) {
      throw new Error('Read-only mode blocks a potentially mutating SQL statement');
    }
  }

  _databaseManagerData() {
    const config = this.configManager.getConfig();
    config.databaseManager = config.databaseManager || { connections: [], savedQueries: [], queryHistory: [] };
    config.databaseManager.savedQueries = Array.isArray(config.databaseManager.savedQueries) ? config.databaseManager.savedQueries : [];
    config.databaseManager.queryHistory = Array.isArray(config.databaseManager.queryHistory) ? config.databaseManager.queryHistory : [];
    return config;
  }

  _saveDatabaseManager(config) {
    const result = this.configManager.saveConfig(config);
    if (!result.success) throw new Error(result.error || 'Could not save Database Manager state');
  }

  _recordWorkbenchHistory(entry) {
    try {
      const config = this._databaseManagerData();
      const history = config.databaseManager.queryHistory;
      config.databaseManager.queryHistory = [entry, ...history.filter(item => item.query !== entry.query || item.database !== entry.database)].slice(0, 100);
      this._saveDatabaseManager(config);
    } catch {}
  }

  queryHistory(limit = 100) {
    return structuredClone(this._databaseManagerData().databaseManager.queryHistory.slice(0, Math.max(1, Math.min(100, Number(limit) || 100))));
  }

  clearQueryHistory() {
    const config = this._databaseManagerData();
    config.databaseManager.queryHistory = [];
    this._saveDatabaseManager(config);
    return { success: true };
  }

  listSavedQueries() { return structuredClone(this._databaseManagerData().databaseManager.savedQueries); }

  saveQuery(input = {}) {
    const query = String(input.query || '').trim();
    if (!query || query.length > 1024 * 1024) throw new Error('Saved query is empty or too large');
    const config = this._databaseManagerData();
    const id = typeof input.id === 'string' && /^[a-f0-9-]{16,64}$/i.test(input.id) ? input.id : crypto.randomUUID();
    const previous = config.databaseManager.savedQueries.find(item => item.id === id);
    const saved = {
      id,
      name: String(input.name || previous?.name || 'Untitled query').trim().slice(0, 120) || 'Untitled query',
      query,
      type: ['postgresql', 'mysql', 'mariadb', 'mongodb'].includes(input.type) ? input.type : '',
      database: String(input.database || '').slice(0, 128),
      tags: [...new Set((Array.isArray(input.tags) ? input.tags : []).map(value => String(value).trim()).filter(Boolean))].slice(0, 20),
      createdAt: previous?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const index = config.databaseManager.savedQueries.findIndex(item => item.id === id);
    if (index >= 0) config.databaseManager.savedQueries[index] = saved;
    else config.databaseManager.savedQueries.unshift(saved);
    config.databaseManager.savedQueries = config.databaseManager.savedQueries.slice(0, 200);
    this._saveDatabaseManager(config);
    return structuredClone(saved);
  }

  removeSavedQuery(id) {
    const config = this._databaseManagerData();
    const before = config.databaseManager.savedQueries.length;
    config.databaseManager.savedQueries = config.databaseManager.savedQueries.filter(item => item.id !== id);
    this._saveDatabaseManager(config);
    return { success: true, removed: before !== config.databaseManager.savedQueries.length };
  }

  async executeWorkbench(input, database, query, options = {}) {
    if (!query?.trim()) throw new Error('Empty query');
    if (query.length > 1024 * 1024) throw new Error('Query is too large');
    const connection = this._resolveConnection(input);
    const readOnly = options.readOnly !== false;
    const transaction = Boolean(options.transaction) && connection.type !== 'mongodb';
    const explain = Boolean(options.explain);
    const timeoutMs = Math.max(1000, Math.min(5 * 60 * 1000, Number(options.timeoutMs) || 30000));
    const maxRows = Math.max(1, Math.min(10000, Number(options.maxRows) || 1000));
    const queryId = typeof options.queryId === 'string' && /^[A-Za-z0-9-]{8,80}$/.test(options.queryId) ? options.queryId : crypto.randomUUID();
    if (readOnly || explain) this._assertReadOnlyQuery(connection.type, query);
    const started = Date.now();
    try {
      let result = await this._withNativeConnection(connection, database, async context => {
        const cancel = () => {
          try {
            if (context.type === 'postgresql') context.client.end();
            else if (context.type === 'mysql' || context.type === 'mariadb') context.client.destroy();
            else context.client.close();
          } catch {}
        };
        this.activeQueries.set(queryId, { queryId, connection: connection.name, database, startedAt: new Date(started).toISOString(), cancel });
        try {
          if (context.type === 'postgresql') {
            if (transaction) await context.client.query(readOnly ? 'BEGIN READ ONLY' : 'BEGIN');
            await context.client.query(`SET statement_timeout TO ${timeoutMs}`);
            const statement = explain ? `EXPLAIN (FORMAT JSON) ${query}` : query;
            try {
              const response = await context.client.query(statement);
              if (transaction) await context.client.query('COMMIT');
              const finalResult = Array.isArray(response) ? response[response.length - 1] : response;
              return finalResult?.rows?.length
                ? this._objectRows(finalResult.rows)
                : { columns: [], rows: [], message: `Query executed successfully${Number.isInteger(finalResult?.rowCount) ? ` · ${finalResult.rowCount} affected` : ''}` };
            } catch (error) { if (transaction) await context.client.query('ROLLBACK').catch(() => {}); throw error; }
          }
          if (context.type === 'mysql' || context.type === 'mariadb') {
            await context.client.query(`SET SESSION MAX_EXECUTION_TIME=${timeoutMs}`).catch(() => {});
            if (transaction) await context.client.beginTransaction();
            const statement = explain ? `EXPLAIN FORMAT=JSON ${query}` : query;
            try {
              const [rows] = await context.client.query(statement);
              if (transaction) await context.client.commit();
              return Array.isArray(rows) ? this._objectRows(rows) : { columns: [], rows: [], message: `Query executed successfully · ${Number(rows?.affectedRows || 0)} affected` };
            } catch (error) { if (transaction) await context.client.rollback().catch(() => {}); throw error; }
          }
          if (explain) throw new Error('Explain is currently available for PostgreSQL, MySQL and MariaDB queries');
          return this._executeMongoOperation(context.db, query);
        } finally { this.activeQueries.delete(queryId); }
      });
      const totalRows = result.rows?.length || 0;
      if (totalRows > maxRows) result = { ...result, rows: result.rows.slice(0, maxRows), truncated: true, totalRows };
      const durationMs = Date.now() - started;
      const metadata = { queryId, durationMs, readOnly, transaction, explain, maxRows };
      this._recordWorkbenchHistory({ id: crypto.randomUUID(), query, database, type: connection.type, connection: connection.name, success: true, durationMs, readOnly, at: new Date().toISOString() });
      return { ...result, ...metadata };
    } catch (error) {
      this.activeQueries.delete(queryId);
      this._recordWorkbenchHistory({ id: crypto.randomUUID(), query, database, type: connection.type, connection: connection.name, success: false, durationMs: Date.now() - started, readOnly, error: error.message.slice(0, 500), at: new Date().toISOString() });
      throw error;
    }
  }

  cancelQuery(queryId) {
    const query = this.activeQueries.get(queryId);
    if (!query) return { success: false, error: 'Active query not found' };
    query.cancel();
    this.activeQueries.delete(queryId);
    return { success: true };
  }

  listActiveQueries() {
    return [...this.activeQueries.values()].map(({ cancel: _cancel, ...query }) => ({ ...query, elapsedMs: Date.now() - Date.parse(query.startedAt) }));
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
