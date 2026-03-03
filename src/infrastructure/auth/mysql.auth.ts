import { AuthenticationCreds, AuthenticationState, BufferJSON, initAuthCreds, proto, SignalDataTypeMap } from '@whiskeysockets/baileys';
import pool from '../database/connection';
import { RowDataPacket } from 'mysql2';

// Define table name locally
const TABLE_NAME = 'bailey_sessions';

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

    await pool.query(createTableQuery);

    const writeData = async (data: any, key: string) => {
        const pk_id = `${sessionId}-${key}`;
        try {
            await pool.query(
                `INSERT INTO ${TABLE_NAME} (pk_id, session_id, data) VALUES (?, ?, ?) 
                 ON DUPLICATE KEY UPDATE data = VALUES(data)`,
                [pk_id, sessionId, JSON.stringify(data, BufferJSON.replacer)]
            );
            // console.log(`[MySQL] Wrote key ${key}`);
        } catch (error) {
            console.error('Error writing auth data to MySQL:', error);
        }
    }

    const readData = async (key: string) => {
        const pk_id = `${sessionId}-${key}`;
        try {
            const [rows] = await pool.query<RowDataPacket[]>(
                `SELECT data FROM ${TABLE_NAME} WHERE pk_id = ?`,
                [pk_id]
            );

            if (rows.length > 0) {
                let rawData = rows[0].data;

                // mysql2 might return the column as an object (if recognized as JSON) 
                // or as a string/Buffer. We need a string for BufferJSON.reviver.
                let jsonString: string;
                if (typeof rawData === 'string') {
                    jsonString = rawData;
                } else if (Buffer.isBuffer(rawData)) {
                    jsonString = rawData.toString('utf-8');
                } else {
                    // It's already an object, stringify it with replacer to preserve structure
                    // then parse it back with reviver.
                    jsonString = JSON.stringify(rawData);
                }

                try {
                    return JSON.parse(jsonString, BufferJSON.reviver);
                } catch (parseError) {
                    console.error(`[MySQL] Error parsing data for key ${key}:`, parseError);
                    return null;
                }
            }
            return null;
        } catch (error) {
            console.error(`[MySQL] Error reading auth data from MySQL for key ${key}:`, error);
            return null;
        }
    }

    const removeData = async (key: string) => {
        const pk_id = `${sessionId}-${key}`;
        try {
            await pool.query(
                `DELETE FROM ${TABLE_NAME} WHERE pk_id = ?`,
                [pk_id]
            );
        } catch (error) {
            console.error('Error removing auth data from MySQL:', error);
        }
    }

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
                    // Formerly skipped keys. Now persisting EVERYTHING to ensure message decryption works after restart.
                    // const SKIP_TYPES = ['sender-key', 'sender-key-memory', 'session', 'pre-key'];
                    // if (SKIP_TYPES.includes(type)) { return {}; }

                    const data: { [key: string]: SignalDataTypeMap[typeof type] } = {};
                    await Promise.all(
                        ids.map(async (id: string) => {
                            const value = await readData(`${type}-${id}`);
                            if (type === 'app-state-sync-key' && value) {
                                data[id] = proto.Message.AppStateSyncKeyData.fromObject(value) as any;
                            } else if (value) {
                                data[id] = value;
                            }
                        })
                    );
                    return data;
                },
                set: async (data: any) => {
                    const tasks: Promise<void>[] = [];
                    for (const category in data) {
                        // Formerly skipped keys removed. Persisting all categories.
                        for (const id in data[category]) {
                            const value = data[category][id];
                            const key = `${category}-${id}`;
                            tasks.push(value ? writeData(value, key) : removeData(key));
                        }
                    }
                    await Promise.all(tasks);
                }
            }
        },
        saveCreds: async () => {
            await writeData(creds, 'creds');
        }
    };
};
