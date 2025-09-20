
const fs = require('fs');
const path = require('path');
const DB_PATH = path.join(__dirname, 'db.json');

function defaultDB() {
  return {
    settings: {
      source_url: 'https://signincode.vivarocky.in/',
      signincode_password: 'atrok',
      fetch_mode: 'curl'
    },
    admin: {
      username: 'admin',
      // bcrypt('admin123')
      password_hash: '$2a$10$wZl.r3e6fY4GiYGtk2k6Uu8Y2A9HnV4hmHJb9Hyr0qFX7wQ7v9q9a'
    },
    users: [
      { username: 'demo', password_hash: '$2a$10$yM1gkgLX3N0H3F8GQLZgx.JVG6lxoC7D2kyzX9NCk7FhHRZrxUPnK', active: true } // bcrypt('demo123')
    ],
    emails: [
      'michelle5fn@mailsgo.uk'
    ]
  };
}

function ensure() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(defaultDB(), null, 2), 'utf-8');
  }
}
function read() { ensure(); return JSON.parse(fs.readFileSync(DB_PATH,'utf-8')); }
function write(db){ fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf-8'); return db; }
function reset(){ const d = defaultDB(); write(d); return d; }

function getSettings(){ return read().settings; }
function updateSettings(patch){ const db = read(); db.settings = { ...db.settings, ...patch }; return write(db).settings; }

function getAdmin(){ return read().admin; }
function setAdminPasswordHash(hash){ const db = read(); db.admin.password_hash = hash; write(db); }

function listUsers(){ return read().users; }
function getUser(u){ return listUsers().find(x => x.username === u) || null; }
function upsertUser(u){ const db = read(); const i = db.users.findIndex(x => x.username === u.username); if (i>=0) db.users[i] = { ...db.users[i], ...u }; else db.users.push(u); write(db); return u; }
function deleteUser(username){ const db = read(); db.users = db.users.filter(x => x.username !== username); write(db); }

function listEmails(){ return read().emails; }
function addEmail(email){ const db = read(); const e = String(email).trim().toLowerCase(); if (!db.emails.includes(e)) db.emails.push(e); write(db); return db.emails; }
function removeEmail(email){ const db = read(); const e = String(email).trim().toLowerCase(); db.emails = db.emails.filter(x => x !== e); write(db); return db.emails; }

module.exports = {
  read, write, reset,
  getSettings, updateSettings,
  getAdmin, setAdminPasswordHash,
  listUsers, getUser, upsertUser, deleteUser,
  listEmails, addEmail, removeEmail
};
