import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT) || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    // Keep-alive settings to prevent ECONNRESET on remote MySQL
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000, // 10 seconds
    idleTimeout: 60000, // 60 seconds idle before closing
    maxIdle: 5
});

export default pool;
