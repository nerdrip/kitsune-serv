'use strict';
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

class DbViewer {
  constructor(downloadManager, configManager, serviceManager) {
    this.downloadManager = downloadManager;
    this.configManager = configManager;
    this.serviceManager = serviceManager;
  }

  _getActiveProfile(section) {
    const config = this.configManager.getConfig();
    const svc = config[section];
    if (!svc || !svc.profiles) return null;
    return svc.profiles.find(p => p.id === svc.activeProfileId) || svc.profiles[0] || null;
  }

  _findCliTool(installPath, section) {
    const isWin = process.platform === 'win32';
    const checks = {
      postgresql: isWin ? ['bin/psql.exe', 'pgsql/bin/psql.exe'] : ['bin/psql', 'pgsql/bin/psql'],
      mysql: isWin ? ['bin/mysql.exe'] : ['bin/mysql'],
      mariadb: isWin ? ['bin/mariadb.exe', 'bin/mysql.exe'] : ['bin/mariadb', 'bin/mysql'],
      mongodb: isWin ? ['bin/mongosh.exe', 'bin/mongo.exe'] : ['bin/mongosh', 'bin/mongo']
    };
    for (const rel of (checks[section] || [])) {
      const full = path.join(installPath, rel);
      if (fs.existsSync(full)) return full;
    }
    return null;
  }

  async _exec(section, database, query) {
    const status = this.serviceManager.getServiceStatus(section);
    if (!status.running) throw new Error('Service is not running');

    const profile = this._getActiveProfile(section);
    if (!profile) throw new Error('No active profile');

    const installPath = this.downloadManager.getInstallPath(section, profile.version);
    const cli = this._findCliTool(installPath, section);
    if (!cli) throw new Error(`CLI tool not found for ${section}. Make sure it is installed.`);

    const host = profile.host || '127.0.0.1';
    const port = String(profile.port);
    const user = profile.username || 'root';
    const pass = profile.password || '';

    return new Promise((resolve, reject) => {
      let args;
      const env = { ...process.env };

      switch (section) {
        case 'postgresql':
          args = ['-h', host, '-p', port, '-U', user, '-d', database || 'postgres',
                  '--no-align', '-F', '\t', '--pset', 'footer=off', '-c', query];
          env.PGPASSWORD = pass;
          break;
        case 'mysql':
        case 'mariadb':
          args = ['-h', host, '-P', port, '-u', user, '--batch', '--raw'];
          if (pass) args.push(`-p${pass}`);
          args.push('-e', query);
          if (database) args.push(database);
          break;
        case 'mongodb': {
          const conn = `mongodb://${host}:${port}/${database || 'admin'}`;
          args = [conn, '--quiet', '--eval', query];
          break;
        }
        default:
          return reject(new Error('Unsupported database type'));
      }

      execFile(cli, args, { env, timeout: 30000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) return reject(new Error(stderr?.trim() || err.message));
        resolve(stdout.trim());
      });
    });
  }

  _parseTabular(raw) {
    if (!raw) return { columns: [], rows: [] };
    const lines = raw.split('\n').filter(l => l.length > 0);
    if (lines.length === 0) return { columns: [], rows: [] };
    const columns = lines[0].split('\t');
    const rows = lines.slice(1).map(l => l.split('\t'));
    return { columns, rows };
  }

  async listDatabases(section) {
    switch (section) {
      case 'postgresql': {
        const raw = await this._exec(section, 'postgres',
          "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname;");
        return this._parseTabular(raw).rows.map(r => r[0]).filter(Boolean);
      }
      case 'mysql':
      case 'mariadb': {
        const raw = await this._exec(section, null, 'SHOW DATABASES;');
        return this._parseTabular(raw).rows.map(r => r[0]).filter(Boolean);
      }
      case 'mongodb': {
        const raw = await this._exec(section, 'admin',
          'JSON.stringify(db.adminCommand("listDatabases").databases.map(d=>d.name))');
        return JSON.parse(raw);
      }
    }
    return [];
  }

  async listTables(section, database) {
    switch (section) {
      case 'postgresql': {
        const raw = await this._exec(section, database,
          "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;");
        return this._parseTabular(raw).rows.map(r => r[0]).filter(Boolean);
      }
      case 'mysql':
      case 'mariadb': {
        const raw = await this._exec(section, database, 'SHOW TABLES;');
        return this._parseTabular(raw).rows.map(r => r[0]).filter(Boolean);
      }
      case 'mongodb': {
        const raw = await this._exec(section, database,
          'JSON.stringify(db.getCollectionNames())');
        return JSON.parse(raw);
      }
    }
    return [];
  }

  async tableData(section, database, table, limit = 100, offset = 0) {
    const safeTable = table.replace(/["`';]/g, '');
    const safeLimit = Math.max(1, Math.min(1000, parseInt(limit) || 100));
    const safeOffset = Math.max(0, parseInt(offset) || 0);

    switch (section) {
      case 'postgresql': {
        const raw = await this._exec(section, database,
          `SELECT * FROM "${safeTable}" LIMIT ${safeLimit} OFFSET ${safeOffset};`);
        return this._parseTabular(raw);
      }
      case 'mysql':
      case 'mariadb': {
        const raw = await this._exec(section, database,
          `SELECT * FROM \`${safeTable}\` LIMIT ${safeLimit} OFFSET ${safeOffset};`);
        return this._parseTabular(raw);
      }
      case 'mongodb': {
        const raw = await this._exec(section, database,
          `JSON.stringify(db.getCollection("${safeTable}").find().skip(${safeOffset}).limit(${safeLimit}).toArray())`);
        const docs = JSON.parse(raw);
        if (!docs.length) return { columns: [], rows: [] };
        const columns = [...new Set(docs.flatMap(d => Object.keys(d)))];
        const rows = docs.map(d => columns.map(c =>
          d[c] != null ? (typeof d[c] === 'object' ? JSON.stringify(d[c]) : String(d[c])) : ''));
        return { columns, rows };
      }
    }
    return { columns: [], rows: [] };
  }

  async executeQuery(section, database, query) {
    if (!query?.trim()) throw new Error('Empty query');

    if (section === 'mongodb') {
      const raw = await this._exec(section, database, query);
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          if (!parsed.length) return { columns: [], rows: [], message: 'Empty result' };
          const columns = [...new Set(parsed.flatMap(d => Object.keys(d)))];
          const rows = parsed.map(d => columns.map(c =>
            d[c] != null ? (typeof d[c] === 'object' ? JSON.stringify(d[c]) : String(d[c])) : ''));
          return { columns, rows };
        }
        return { columns: ['result'], rows: [[JSON.stringify(parsed, null, 2)]] };
      } catch {
        return { columns: ['output'], rows: [[raw]] };
      }
    }

    const raw = await this._exec(section, database, query);
    if (!raw) return { columns: [], rows: [], message: 'Query executed successfully' };
    return this._parseTabular(raw);
  }

  async createDatabase(section, name) {
    const safeName = name.replace(/[^a-zA-Z0-9_]/g, '');
    if (!safeName) throw new Error('Invalid database name');

    switch (section) {
      case 'postgresql':
        await this._exec(section, 'postgres', `CREATE DATABASE "${safeName}";`);
        break;
      case 'mysql':
      case 'mariadb':
        await this._exec(section, null, `CREATE DATABASE \`${safeName}\`;`);
        break;
      case 'mongodb':
        await this._exec(section, safeName, 'db.createCollection("_init")');
        break;
    }
    return { success: true };
  }

  async dropDatabase(section, name) {
    const safeName = name.replace(/[^a-zA-Z0-9_]/g, '');
    if (!safeName) throw new Error('Invalid database name');

    switch (section) {
      case 'postgresql':
        await this._exec(section, 'postgres', `DROP DATABASE IF EXISTS "${safeName}";`);
        break;
      case 'mysql':
      case 'mariadb':
        await this._exec(section, null, `DROP DATABASE IF EXISTS \`${safeName}\`;`);
        break;
      case 'mongodb':
        await this._exec(section, safeName, 'db.dropDatabase()');
        break;
    }
    return { success: true };
  }
}

module.exports = DbViewer;
