import { AuthenticationCreds, AuthenticationState, BufferJSON, initAuthCreds, proto, SignalDataTypeMap } from '@whiskeysockets/baileys';
import pool from '../database/connection';
import { RowDataPacket } from 'mysql2';

// Define table name locally
const TABLE_NAME = 'bailey_sessions';

// Global In-Memory Cache per session to protect remote MySQL (Hostinger/AWS) connection limits
// Key: pk_id -> parsed data
const memoryAuthCache = new Map<string, any>();

export const clearSessionMemoryCache = (sessionId: string) => {
    const prefix = `${sessionId}-`;
    for (const key of memoryAuthCache.keys()) {
        if (key.startsWith(prefix)) {
            memoryAuthCache.delete(key);
        }
    }
};

export const deleteSessionAuth = async (sessionId: string) => {
    clearSessionMemoryCache(sessionId);
    try {
        await pool.query(`DELETE FROM ${TABLE_NAME} WHERE session_id = ?`, [sessionId]);
        console.log(`[MySQL Auth] Cleared all auth credentials and keys from MySQL for session: ${sessionId}`);
    } catch (error) {
        console.error(`[MySQL Auth] Error deleting auth data for session ${sessionId}:`, error);
    }
};

export const useMySQLAuthState = async (sessionId: string): Promise<{ state: AuthenticationState, saveCreds: () => Promise<void> }> => {

    // Ensure table exists
    const createTableQuery = `
        CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
            pk_id VARCHAR(255) NOT NULL,
            session_id VARCHAR(100) NOT NULL,
            data JSON NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (pk_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;

    try {
        await pool.query(createTableQuery);
    } catch (e) {
        console.warn(`[MySQL Auth] Table check warning:`, e);
    }

    const parseRowData = (rawData: any, key: string) => {
        if (!rawData) return null;
        let jsonString: string;
        if (typeof rawData === 'string') {
            jsonString = rawData;
        } else if (Buffer.isBuffer(rawData)) {
            jsonString = rawData.toString('utf-8');
        } else {
            jsonString = JSON.stringify(rawData);
        }

        try {
            return JSON.parse(jsonString, BufferJSON.reviver);
        } catch (parseError) {
            console.error(`[MySQL] Error parsing data for key ${key}:`, parseError);
            return null;
        }
    };

    const readData = async (key: string) => {
        const pk_id = `${sessionId}-${key}`;
        if (memoryAuthCache.has(pk_id)) {
            return memoryAuthCache.get(pk_id);
        }

        try {
            const [rows] = await pool.query<RowDataPacket[]>(
                `SELECT data FROM ${TABLE_NAME} WHERE pk_id = ?`,
                [pk_id]
            );

            if (rows.length > 0) {
                const parsed = parseRowData(rows[0].data, key);
                if (parsed) {
                    memoryAuthCache.set(pk_id, parsed);
                }
                return parsed;
            }
            return null;
        } catch (error) {
            console.error(`[MySQL] Error reading auth data from MySQL for key ${key}:`, error);
            return null;
        }
    };

    const writeData = async (data: any, key: string) => {
        const pk_id = `${sessionId}-${key}`;
        memoryAuthCache.set(pk_id, data);

        try {
            await pool.query(
                `INSERT INTO ${TABLE_NAME} (pk_id, session_id, data) VALUES (?, ?, ?) 
                 ON DUPLICATE KEY UPDATE data = VALUES(data)`,
                [pk_id, sessionId, JSON.stringify(data, BufferJSON.replacer)]
            );
        } catch (error) {
            console.error('Error writing auth data to MySQL:', error);
        }
    };

    let creds: AuthenticationCreds;
    const credsData = await readData('creds');

    if (credsData) {
        creds = credsData;
    } else {
        creds = initAuthCreds();
        await writeData(creds, 'creds');
    }

    return {
        state: {
            creds,
            keys: {
                get: async (type: string, ids: string[]) => {
                    const data: { [key: string]: SignalDataTypeMap[typeof type] } = {};
                    if (!ids.length) return data;

                    const missingIds: string[] = [];
                    const missingPkIds: string[] = [];

                    // 1. Check in-memory cache first (O(1) lookups, 0 SQL calls)
                    for (const id of ids) {
                        const pk_id = `${sessionId}-${type}-${id}`;
                        if (memoryAuthCache.has(pk_id)) {
                            const val = memoryAuthCache.get(pk_id);
                            if (type === 'app-state-sync-key' && val) {
                                data[id] = proto.Message.AppStateSyncKeyData.fromObject(val) as any;
                            } else if (val) {
                                data[id] = val;
                            }
                        } else {
                            missingIds.push(id);
                            missingPkIds.push(pk_id);
                        }
                    }

                    // 2. Query MySQL ONLY for cache misses in a single batch
                    if (missingPkIds.length > 0) {
                        try {
                            const placeholders = missingPkIds.map(() => '?').join(',');
                            const [rows] = await pool.query<RowDataPacket[]>(
                                `SELECT pk_id, data FROM ${TABLE_NAME} WHERE pk_id IN (${placeholders})`,
                                missingPkIds
                            );

                            const rowMap = new Map<string, any>();
                            for (const row of rows) {
                                rowMap.set(row.pk_id, row.data);
                            }

                            for (const id of missingIds) {
                                const pk_id = `${sessionId}-${type}-${id}`;
                                const rawValue = rowMap.get(pk_id);
                                if (rawValue) {
                                    const value = parseRowData(rawValue, `${type}-${id}`);
                                    if (value) {
                                        memoryAuthCache.set(pk_id, value);
                                        if (type === 'app-state-sync-key') {
                                            data[id] = proto.Message.AppStateSyncKeyData.fromObject(value) as any;
                                        } else {
                                            data[id] = value;
                                        }
                                    }
                                }
                            }
                        } catch (error) {
                            console.error(`[MySQL Auth Batch Get Error]:`, error);
                        }
                    }

                    return data;
                },
                set: async (data: any) => {
                    const insertValues: [string, string, string][] = [];
                    const deleteKeys: string[] = [];

                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const pk_id = `${sessionId}-${category}-${id}`;
                            if (value) {
                                memoryAuthCache.set(pk_id, value);
                                insertValues.push([pk_id, sessionId, JSON.stringify(value, BufferJSON.replacer)]);
                            } else {
                                memoryAuthCache.delete(pk_id);
                                deleteKeys.push(pk_id);
                            }
                        }
                    }

                    // Bulk insert/update in a single query
                    if (insertValues.length > 0) {
                        try {
                            const placeholders = insertValues.map(() => '(?, ?, ?)').join(',');
                            const flatParams: any[] = [];
                            insertValues.forEach(row => flatParams.push(...row));

                            await pool.query(
                                `INSERT INTO ${TABLE_NAME} (pk_id, session_id, data) VALUES ${placeholders}
                                 ON DUPLICATE KEY UPDATE data = VALUES(data)`,
                                flatParams
                            );
                        } catch (error) {
                            console.error('[MySQL Auth Batch Set Error]:', error);
                        }
                    }

                    // Bulk delete in a single query
                    if (deleteKeys.length > 0) {
                        try {
                            const placeholders = deleteKeys.map(() => '?').join(',');
                            await pool.query(
                                `DELETE FROM ${TABLE_NAME} WHERE pk_id IN (${placeholders})`,
                                deleteKeys
                            );
                        } catch (error) {
                            console.error('[MySQL Auth Batch Delete Error]:', error);
                        }
                    }
                }
            }
        },
        saveCreds: async () => {
            await writeData(creds, 'creds');
        }
    };
};

export const clearMySQLAuthState = async (sessionId: string): Promise<void> => {
    clearSessionMemoryCache(sessionId);
    try {
        await pool.query(
            `DELETE FROM ${TABLE_NAME} WHERE session_id = ?`,
            [sessionId]
        );
        console.log(`[MySQL] Cleared all auth state for session ${sessionId}`);
    } catch (error) {
        console.error(`[MySQL] Error clearing auth state for session ${sessionId}:`, error);
    }
};

export const clearMySQLSessionForJid = async (sessionId: string, phoneOrJid: string): Promise<void> => {
    try {
        const cleanPhone = phoneOrJid.replace(/[^0-9]/g, "");
        if (!cleanPhone) return;

        // Clear in-memory cache keys for this JID/session
        for (const key of memoryAuthCache.keys()) {
            if (key.startsWith(`${sessionId}-session-`) && key.includes(cleanPhone)) {
                memoryAuthCache.delete(key);
            }
        }

        await pool.query(
            `DELETE FROM ${TABLE_NAME} WHERE session_id = ? AND (pk_id LIKE ? OR pk_id LIKE ?)`,
            [sessionId, `${sessionId}-session-${cleanPhone}%`, `${sessionId}-session-%${cleanPhone}%`]
        );
        console.log(`[MySQL] Cleared broken crypto sessions for ${cleanPhone} in company ${sessionId}`);
    } catch (error) {
        console.error(`[MySQL] Error clearing broken crypto session for ${phoneOrJid}:`, error);
    }
};
