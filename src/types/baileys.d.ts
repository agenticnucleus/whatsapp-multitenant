/**
 * Custom type declaration for @whiskeysockets/baileys
 * The library dropped bundled .d.ts files after npm update.
 * This shim declares all exports used by this project.
 * 
 * Files that import from this module:
 * - src/infrastructure/ioc.ts (Baileys.downloadMediaMessage)
 * - src/infrastructure/repositories/baileys.repository.ts (makeWASocket, Browsers, DisconnectReason, etc.)
 * - src/infrastructure/auth/mysql.auth.ts (AuthenticationCreds, AuthenticationState, BufferJSON, etc.)
 */
declare module '@whiskeysockets/baileys' {
    // === Core Socket ===
    export function makeWASocket(config: any): any;
    export default function makeWASocket(config: any): any;

    // === Media Downloads ===
    export function downloadMediaMessage(msg: any, type: string, options: any, ctx?: any): Promise<any>;

    // === Auth Types (used by mysql.auth.ts) ===
    export interface AuthenticationCreds {
        [key: string]: any;
    }
    export interface AuthenticationState {
        creds: AuthenticationCreds;
        keys: any;
    }
    export const BufferJSON: {
        replacer: (key: string, value: any) => any;
        reviver: (key: string, value: any) => any;
    };
    export function initAuthCreds(): AuthenticationCreds;
    export interface SignalDataTypeMap {
        [key: string]: any;
    }

    // === Auth Helpers ===
    export function useMySQLAuthState(sessionId: string): Promise<any>;
    export function useMultiFileAuthState(folder: string): Promise<{
        state: AuthenticationState;
        saveCreds: () => Promise<void>;
    }>;

    // === Connection Constants (used by baileys.repository.ts) ===
    export const Browsers: {
        ubuntu: (browser: string) => [string, string, string];
        macOS: (browser: string) => [string, string, string];
        appropriate: (browser: string) => [string, string, string];
        [key: string]: any;
    };
    export const DisconnectReason: {
        loggedOut: number;
        connectionClosed: number;
        connectionLost: number;
        connectionReplaced: number;
        timedOut: number;
        badSession: number;
        restartRequired: number;
        multideviceMismatch: number;
        [key: string]: number;
    };

    // === Proto / WAProto (used for app-state-sync-key decoding) ===
    export const proto: {
        Message: {
            AppStateSyncKeyData: {
                fromObject: (obj: any) => any;
                [key: string]: any;
            };
            [key: string]: any;
        };
        [key: string]: any;
    };

    // === Socket & Connection Types (used by baileys.repository.ts as Baileys.WASocket / Baileys.ConnectionState) ===
    export interface WASocket {
        ev: any;
        sendMessage: (jid: string, content: any) => Promise<any>;
        logout: () => Promise<void>;
        sendPresenceUpdate: (type: string, jid: string) => Promise<void>;
        updateMediaMessage: any;
        [key: string]: any;
    }
    export interface ConnectionState {
        connection: 'open' | 'close' | 'connecting';
        lastDisconnect?: { error: Error; date: Date };
        qr?: string;
        receivedPendingNotifications?: boolean;
        [key: string]: any;
    }

    // === Catch-all for any other exports ===
    export const WAProto: any;
    export const delay: (ms: number) => Promise<void>;
    export const jidDecode: (jid: string) => any;
    export const areJidsSameUser: (jid1: string, jid2: string) => boolean;
    export const S_WHATSAPP_NET: string;
}
