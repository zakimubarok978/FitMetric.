'use strict';

const fs = require('node:fs');
const readline = require('node:readline/promises');
const { stdin, stdout } = require('node:process');
const server = require('./server');

const EMAIL_PATTERN = server.EMAIL_PATTERN;

function promptHidden(label) {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
      reject(new Error('Password input requires an interactive terminal.'));
      return;
    }
    stdout.write(label);
    let value = '';
    const previousRawMode = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    const onData = (chunk) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') {
          stdin.setRawMode(previousRawMode || false);
          stdin.removeListener('data', onData);
          stdout.write('\n');
          reject(new Error('Setup cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          stdin.setRawMode(previousRawMode || false);
          stdin.removeListener('data', onData);
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1);
        } else if (character >= ' ') {
          value += character;
        }
      }
    };
    stdin.on('data', onData);
  });
}

function createFirstAdmin(db, name, email, password) {
  name = name.trim();
  email = email.trim().toLowerCase();
  if (!name || name.length > 100) throw new Error('Nama Admin wajib diisi dan maksimal 100 karakter.');
  if (!EMAIL_PATTERN.test(email)) throw new Error('Format email Admin tidak valid.');
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) {
    throw new Error('Password harus berjumlah 12 sampai 256 karakter.');
  }
  const createAdmin = db.transaction(() => {
    if (db.prepare('SELECT 1 FROM admin_users LIMIT 1').get()) {
      throw new Error('Akun Admin sudah ada. Pembuatan Admin tambahan dinonaktifkan.');
    }
    if (server.emailIsRegistered(db, email)) {
      throw new Error('Email tersebut sudah digunakan akun Admin, Pelatih, atau Member.');
    }
    db.prepare('INSERT INTO admin_users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(require('node:crypto').randomUUID(), name, email, server.hashPassword(password), server.now());
  });
  createAdmin.immediate();
}

async function main() {
  const databasePath = process.env.FITMETRIC_DB || require('node:path').join(__dirname, 'fitmetric.sqlite3');
  if (!fs.existsSync(databasePath)) {
    throw new Error(`Database FitMetric tidak ditemukan: ${databasePath}. Pastikan FITMETRIC_DB mengarah ke database aplikasi yang benar.`);
  }
  const db = server.openDatabase(databasePath);
  try {
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
    if (!tables.has('users') || !tables.has('admin_users')) {
      throw new Error('Database ini tidak memiliki tabel users dan admin_users FitMetric. Periksa FITMETRIC_DB.');
    }
    const userColumns = new Set(db.pragma('table_info(users)').map((row) => row.name));
    const adminColumns = new Set(db.pragma('table_info(admin_users)').map((row) => row.name));
    if (!['email', 'role'].every((name) => userColumns.has(name)) ||
        !['id', 'name', 'email', 'password_hash', 'created_at'].every((name) => adminColumns.has(name))) {
      throw new Error('Struktur tabel akun tidak kompatibel dengan server.js.');
    }

    const terminal = readline.createInterface({ input: stdin, output: stdout });
    const name = (await terminal.question('Nama lengkap Admin: ')).trim();
    const email = (await terminal.question('Email Admin: ')).trim().toLowerCase();
    terminal.close();
    const password = await promptHidden('Password Admin (minimal 12 karakter): ');
    const confirmation = await promptHidden('Ulangi password Admin: ');
    if (password !== confirmation) throw new Error('Konfirmasi password tidak cocok.');
    createFirstAdmin(db, name, email, password);
    console.log('Akun Admin pertama berhasil dibuat.');
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Gagal membuat akun Admin: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { createFirstAdmin };
