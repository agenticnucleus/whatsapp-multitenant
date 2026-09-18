import * as Baileys from "@whiskeysockets/baileys";
import * as qr from "qr-image";
import pino from "pino";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";

import LeadExternal from "../../domain/lead-external.repository";
import { useMySQLAuthState, clearSessionMemoryCache, deleteSessionAuth } from "../auth/mysql.auth";

interface SessionInfo {
  socket: Baileys.WASocket;
  state: Partial<Baileys.ConnectionState>;
  qrSvg: string | null;
  isReady: boolean;
}

/**
 * Multi-tenant WhatsApp transporter using Baileys.
 * Manages multiple sessions, one per companyId.
 */
export class BaileysTransporter extends EventEmitter implements LeadExternal {
  private sessions: Map<string, SessionInfo> = new Map();
  private retryCount405: Map<string, number> = new Map();
  private jidCache: Map<string, string> = new Map();
  private baileys: typeof Baileys;

  constructor(baileys: typeof Baileys = Baileys) {
    super();
    this.baileys = baileys;
    // Ensure qr_codes directory exists
    if (!fs.existsSync("qr_codes")) {
      fs.mkdirSync("qr_codes");
    }
  }

  private getSessionDir(companyId: string): string {
    return `tokens/${companyId}`;
  }

  private getQrFile(companyId: string): string {
    return path.join("qr_codes", `${companyId}.svg`);
  }

  private async getAuth(companyId: string): Promise<any> {
    try {
      return await useMySQLAuthState(companyId);
    } catch (error) {
      console.error(`[${companyId}] Auth error:`, error);
      throw error;
    }
  }

  /**
   * Scan database for existing sessions and restore them.
   */
  async initialize(): Promise<void> {
    console.log("Initializing Baileys Transporter - Scanning for existing sessions...");
    try {
      const { default: connection } = await import("../database/connection");
      // Get all unique companyIds that have credentials
      const [rows]: any[] = await connection.execute(
        "SELECT DISTINCT session_id FROM bailey_sessions WHERE pk_id LIKE '%-creds'"
      );

      for (const row of rows) {
        const companyId = row.session_id;
        if (companyId) {
          console.log(`[${companyId}] Found existing session in DB, restoring...`);
          // Start detached to not block boot
          this.getStatusWithAutoRestore(companyId).catch(err =>
            console.error(`[${companyId}] Failed to auto-restore on boot:`, err)
          );
        }
      }
    } catch (error) {
      console.error("Failed to initialize sessions from DB:", error);
    }
  }

  /**
   * Start or restart a session for a given company.
   * If forceNew is true, wipes old credentials and forces a fresh QR generation.
   */
  async startSession(companyId: string, forceNew = false): Promise<{ status: string; message: string }> {
    // If session exists and is open and not forcing new, return early
    const existingSession = this.sessions.get(companyId);
    if (!forceNew && existingSession && existingSession.state.connection === "open") {
      return { status: "connected", message: "Session already connected" };
    }

    if (forceNew) {
      console.log(`[${companyId}] Force starting fresh session (wiping old credentials)...`);
      if (existingSession?.socket) {
        try {
          existingSession.socket.end(new Error("Force restart requested"));
        } catch (e) { }
      }
      this.sessions.delete(companyId);
      await deleteSessionAuth(companyId);
      if (fs.existsSync(this.getQrFile(companyId))) {
        try { fs.unlinkSync(this.getQrFile(companyId)); } catch (e) { }
      }
    }

    try {
      const { saveCreds, state } = await this.getAuth(companyId);

      let waVersion: [number, number, number] | undefined = undefined;
      try {
        const fetchVersion = (Baileys as any).fetchLatestBaileysVersion || (Baileys as any).fetchLatestWaWebVersion;
        if (typeof fetchVersion === "function") {
          const vInfo = await fetchVersion();
          if (vInfo && Array.isArray(vInfo.version)) {
            waVersion = vInfo.version as [number, number, number];
            console.log(`[${companyId}] Using latest WhatsApp Web version: ${waVersion.join('.')}`);
          }
        }
      } catch (verErr) {
        console.warn(`[${companyId}] Could not fetch latest WA version, using default:`, verErr);
      }

      const socket = this.baileys.makeWASocket({
        printQRInTerminal: false,
        browser: (Baileys as any).Browsers ? (Baileys as any).Browsers.ubuntu("Chrome") : ["Ubuntu", "Chrome", "22.04.4"],
        ...(waVersion ? { version: waVersion } : {}),
        syncFullHistory: false, // Prevents downloading massive history and flooding DB queries
        markOnlineOnConnect: true,
        keepAliveIntervalMs: 25000,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        //@ts-ignore
        logger: pino({ level: "silent" }),
        auth: state,
      });

      const sessionInfo: SessionInfo = {
        socket,
        state: {},
        qrSvg: null,
        isReady: false,
      };
      this.sessions.set(companyId, sessionInfo);

      socket.ev.on("creds.update", saveCreds);

      socket.ev.on("connection.update", async (update: any) => {
        const { connection, qr: qrCode, lastDisconnect } = update;
        // CRITICAL FIX: Merge state updates, do not overwrite! 
        // Baileys emits partial updates (e.g., { receivedPendingNotifications: true }).
        sessionInfo.state = { ...sessionInfo.state, ...update };

        if (qrCode) {
          // Generate SVG QR code
          const qrSvg = qr.imageSync(qrCode, { type: "svg" });
          const svgString = qrSvg.toString();

          sessionInfo.qrSvg = svgString;

          // Save QR to file as requested
          try {
            fs.writeFileSync(this.getQrFile(companyId), svgString);
            console.log(`[${companyId}] QR code generated and saved to ${this.getQrFile(companyId)}`);
          } catch (err) {
            console.error(`[${companyId}] Error saving QR file:`, err);
          }

          this.emit("qr", { companyId, qrSvg: svgString });
        }

        if (connection === "open") {
          sessionInfo.isReady = true;
          sessionInfo.qrSvg = null; // Clear QR once connected
          this.retryCount405.delete(companyId); // Reset retry counter on successful connection

          // Remove QR file
          if (fs.existsSync(this.getQrFile(companyId))) {
            fs.unlinkSync(this.getQrFile(companyId));
          }

          this.emit("connected", { companyId });
          console.log(`[${companyId}] Connection opened successfully!`);
        }

        if (connection === "close") {
          sessionInfo.isReady = false;

          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const isLoggedOut = statusCode === Baileys.DisconnectReason.loggedOut || statusCode === 401;
          const shouldReconnect = !isLoggedOut && statusCode !== 405;

          console.log(`[${companyId}] Connection closed. Reason: ${statusCode}, isLoggedOut: ${isLoggedOut}, Error: ${lastDisconnect?.error}`);

          if (statusCode === 405) {
            const retries = (this.retryCount405.get(companyId) || 0) + 1;
            this.retryCount405.set(companyId, retries);
            const MAX_405_RETRIES = 3;

            console.log(`[${companyId}] Error 405 (attempt ${retries}/${MAX_405_RETRIES}). Cleaning session...`);
            try {
              this.sessions.delete(companyId);
              if (fs.existsSync(this.getQrFile(companyId))) fs.unlinkSync(this.getQrFile(companyId));

              if (retries < MAX_405_RETRIES) {
                setTimeout(() => this.startSession(companyId), 3000);
              } else {
                console.error(`[${companyId}] Max 405 retries reached. Session stopped. User must re-initialize from frontend.`);
                this.retryCount405.delete(companyId);
              }
              return;
            } catch (cleanErr) {
              console.error(`[${companyId}] Cleanup error:`, cleanErr);
            }
          }

          if (shouldReconnect) {
            console.log(`[${companyId}] Reconnecting in 3 seconds...`);
            setTimeout(() => {
              this.startSession(companyId);
            }, 3000);
          } else {
            console.log(`[${companyId}] Session logged out or permanently disconnected. Wiping old credentials...`);
            this.sessions.delete(companyId);
            await deleteSessionAuth(companyId);
            this.emit("disconnected", { companyId, reason: "logged_out" });

            try {
              if (fs.existsSync(this.getQrFile(companyId))) fs.unlinkSync(this.getQrFile(companyId));
            } catch (e) { }
          }
        }
      });

      // Handle incoming messages (emit event for webhook processing)
      socket.ev.on("messages.upsert", async (m: any) => {
        console.log(`[${companyId}] messages.upsert received:`, JSON.stringify(m, null, 2));
        if (m.type === "notify") {
          for (const msg of m.messages) {
            console.log(`[${companyId}] Processing message key:`, msg.key);
            if (!msg.key.fromMe) {
              if (msg.key.remoteJid) {
                const rJid = msg.key.remoteJid;
                const digits = rJid.split('@')[0].replace(/[^0-9]/g, "");
                if (digits) {
                  this.jidCache.set(`${companyId}:${digits}`, rJid);
                  this.jidCache.set(digits, rJid);
                  console.log(`[${companyId}] Cached sender JID: ${digits} -> ${rJid}`);
                }
              }
              console.log(`[${companyId}] Emitting message event to IoC...`);
              this.emit("message", { companyId, message: msg });
            } else {
              console.log(`[${companyId}] Ignored message (fromMe = true)`);
            }
          }
        }
      });

      return { status: "initializing", message: "Session started, scan QR code" };
    } catch (error) {
      console.error(`[${companyId}] Failed to start session:`, error);
      throw error;
    }
  }

  /**
   * Get the current QR code SVG for a company session.
   */
  getQr(companyId: string): string | null {
    const session = this.sessions.get(companyId);
    if (session?.qrSvg) {
      return session.qrSvg;
    }

    // Fallback to file system
    try {
      const file = this.getQrFile(companyId);
      if (fs.existsSync(file)) {
        return fs.readFileSync(file, "utf-8");
      }
    } catch (e) {
      console.error(`[${companyId}] Error reading QR file:`, e);
    }
    return null;
  }

  /**
   * Get session status for a company including live connected phone number.
   */
  getStatus(companyId: string): { connected: boolean; state: string | null; status: string | null; phone: string | null } {
    const session = this.sessions.get(companyId);
    if (!session) {
      return { connected: false, state: null, status: null, phone: null };
    }
    const connectionState = session.state.connection || null;
    const isConnected = connectionState === "open";
    let phone: string | null = null;
    if (isConnected && session.socket?.user) {
      const rawUser = session.socket.user.id || "";
      phone = rawUser.split(":")[0].split("@")[0] || null;
    }
    return {
      connected: isConnected,
      state: connectionState,
      status: connectionState, // Alias for backend compatibility
      phone,
    };
  }

  /**
   * Get session status with auto-restore from MySQL.
   * If session is not in memory but credentials exist in MySQL, auto-start the session.
   */
  async getStatusWithAutoRestore(companyId: string): Promise<{ connected: boolean; state: string | null; status: string | null; phone: string | null; restoring?: boolean }> {
    // Check if session exists in memory
    const existingSession = this.sessions.get(companyId);
    if (existingSession) {
      const connectionState = existingSession.state.connection || null;
      const isConnected = connectionState === "open";
      let phone: string | null = null;
      if (isConnected && existingSession.socket?.user) {
        const rawUser = existingSession.socket.user.id || "";
        phone = rawUser.split(":")[0].split("@")[0] || null;
      }
      return {
        connected: isConnected,
        state: connectionState,
        status: connectionState,
        phone,
      };
    }

    // Session not in memory - check if credentials exist in MySQL
    try {
      const { state } = await useMySQLAuthState(companyId);

      // Check if credentials have been paired (me.id exists means device was paired)
      if (state.creds && state.creds.me && state.creds.me.id) {
        const rawUser = state.creds.me.id || "";
        const savedPhone = rawUser.split(":")[0].split("@")[0] || null;
        // Auto-start session in background (don't wait for it)
        console.log(`[${companyId}] Auto-restoring session from MySQL...`);
        this.startSession(companyId).catch(err => {
          console.error(`[${companyId}] Auto-restore failed:`, err);
        });

        return {
          connected: false,
          state: "restoring",
          status: "restoring",
          phone: savedPhone,
          restoring: true,
        };
      }
    } catch (error) {
      console.error(`[${companyId}] Error checking stored credentials:`, error);
    }

    return { connected: false, state: null, status: null, phone: null };
  }

  /**
   * Logout and disconnect a session.
   */
  async logout(companyId: string): Promise<{ status: string }> {
    const session = this.sessions.get(companyId);
    if (session?.socket) {
      try {
        await session.socket.logout();
      } catch (error) {
        console.warn(`[${companyId}] Socket logout warning:`, error);
      }
    }
    this.sessions.delete(companyId);
    await deleteSessionAuth(companyId);
    if (fs.existsSync(this.getQrFile(companyId))) {
      try { fs.unlinkSync(this.getQrFile(companyId)); } catch (e) { }
    }
    return { status: "logged_out" };
  }

  private normalizePhone(phone: string): string {
    let clean = (phone || "").replace(/[^0-9]/g, "");
    // If entered with leading 0 and exactly 10 digits (e.g. local 09xxxxxxxx in Ecuador)
    if (clean.startsWith("0") && clean.length === 10) {
      clean = "593" + clean.substring(1);
    }
    // Any other number (e.g. 1xxxxxxxxxx US/CA, 52xxxxxxxxxx Mexico, 34xxxxxxxxx Spain, 593xxxxxxxxx Ecuador, 57xxxxxxxxxx Colombia)
    // is preserved directly with its international country code.
    return clean;
  }

  private async getOrRestoreSession(companyId: string): Promise<SessionInfo | null> {
    let session = this.sessions.get(companyId);
    if (session?.socket && (session.isReady || session.state?.connection === "open")) {
      return session;
    }

    // Check if another active session exists in memory (e.g. "1" or "default")
    if (this.sessions.size > 0) {
      for (const [sId, sInfo] of this.sessions.entries()) {
        if (sInfo.socket && (sInfo.isReady || sInfo.state?.connection === "open")) {
          console.log(`[${companyId}] Found active session under id '${sId}', reusing it.`);
          return sInfo;
        }
      }
    }

    // Try auto-restoring from MySQL
    console.log(`[${companyId}] Auto-restoring session from MySQL for messaging...`);
    await this.getStatusWithAutoRestore(companyId);

    // Wait up to 3 seconds for socket initialization
    for (let i = 0; i < 6; i++) {
      session = this.sessions.get(companyId);
      if (session?.socket && (session.isReady || session.state?.connection === "open")) {
        return session;
      }
      await new Promise(r => setTimeout(r, 500));
    }

    return this.sessions.get(companyId) || null;
  }

  private resolveJid(phone: string, companyId?: string): string {
    const trimmed = (phone || "").trim();
    if (trimmed.includes("@lid") || trimmed.includes("@s.whatsapp.net")) {
      return trimmed;
    }

    const digitsOnly = trimmed.replace(/[^0-9]/g, "");

    // 1. Check in-memory JID cache for this company or global
    if (companyId && this.jidCache.has(`${companyId}:${digitsOnly}`)) {
      const cached = this.jidCache.get(`${companyId}:${digitsOnly}`)!;
      console.log(`[${companyId}] Resolved JID from cache: ${cached}`);
      return cached;
    }
    if (this.jidCache.has(digitsOnly)) {
      const cached = this.jidCache.get(digitsOnly)!;
      console.log(`Resolved JID from global cache: ${cached}`);
      return cached;
    }

    // 2. Multi-device LID heuristic:
    // LIDs in WhatsApp are 13 to 16 digits (or longer) and do not match standard country phone numbers.
    const isStandardPhone = 
      (digitsOnly.startsWith("593") && digitsOnly.length <= 12) ||
      (digitsOnly.startsWith("52") && digitsOnly.length <= 12) ||
      (digitsOnly.startsWith("57") && digitsOnly.length <= 12) ||
      (digitsOnly.startsWith("34") && digitsOnly.length <= 11) ||
      (digitsOnly.startsWith("1") && digitsOnly.length <= 11) ||
      (digitsOnly.startsWith("51") && digitsOnly.length <= 11) ||
      (digitsOnly.startsWith("56") && digitsOnly.length <= 11) ||
      (digitsOnly.startsWith("549") && digitsOnly.length <= 13);

    const isLid = (digitsOnly.length >= 13 && !isStandardPhone) || digitsOnly.length >= 14;
    if (isLid) {
      return `${digitsOnly}@lid`;
    }

    const cleanPhone = this.normalizePhone(trimmed);
    return `${cleanPhone}@s.whatsapp.net`;
  }

  /**
   * Send a text message from a specific company session.
   */
  async sendMsg({
    message,
    phone,
    companyId,
  }: {
    message: string;
    phone: string;
    companyId?: string;
  }): Promise<any> {
    const targetCompanyId = companyId || "1";
    console.log(`[${targetCompanyId}] Sending message to ${phone}: ${message}`);
    const session = await this.getOrRestoreSession(targetCompanyId);

    if (!session || !session.socket) {
      throw new Error(`Session for ${targetCompanyId} not found or not connected. Please scan QR in channels.`);
    }

    try {
      const jid = this.resolveJid(phone, targetCompanyId);
      console.log(`[${targetCompanyId}] Resolved JID for send: ${jid}`);

      const response = await session.socket.sendMessage(jid, { text: message });
      return response;
    } catch (error) {
      console.error(`[${targetCompanyId}] Send message error:`, error);
      throw error;
    }
  }

  /**
   * Send media (document, image, audio, video) from a specific company session.
   */
  async sendMedia({
    companyId,
    phone,
    mediaUrl,
    mediaType,
    caption,
    fileName,
  }: {
    companyId: string;
    phone: string;
    mediaUrl: string;
    mediaType: "image" | "video" | "audio" | "document";
    caption?: string;
    fileName?: string;
  }): Promise<any> {
    const targetCompanyId = companyId || "1";
    const session = await this.getOrRestoreSession(targetCompanyId);

    if (!session || !session.socket) {
      throw new Error(`Session for ${targetCompanyId} is not connected`);
    }

    try {
      const jid = this.resolveJid(phone, targetCompanyId);
      console.log(`[${targetCompanyId}] Resolved JID for sendMedia: ${jid}`);

      let messageContent: any = {};

      switch (mediaType) {
        case "image":
          messageContent = { image: { url: mediaUrl }, caption };
          break;
        case "video":
          messageContent = { video: { url: mediaUrl }, caption };
          break;
        case "audio":
          messageContent = { audio: { url: mediaUrl }, mimetype: "audio/mp4", ptt: true };
          break;
        case "document":
          let mime = "application/pdf";
          if (fileName?.endsWith(".xlsx") || fileName?.endsWith(".xls")) {
            mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
          } else if (fileName?.endsWith(".csv")) {
            mime = "text/csv";
          }
          messageContent = {
            document: { url: mediaUrl },
            fileName: fileName || "documento.pdf",
            mimetype: mime,
          };
          break;
      }

      const response = await session.socket.sendMessage(jid, messageContent);
      return response;
    } catch (error) {
      console.error(`[${targetCompanyId}] Send media error:`, error);
      throw error;
    }
  }

  /**
   * Send typing indicator
   */
  async sendTyping({ phone, companyId }: { phone: string; companyId?: string }): Promise<any> {
    const targetCompanyId = companyId || "default";
    const session = this.sessions.get(targetCompanyId);

    if (!session || !session.isReady) {
      return { status: "not_connected" };
    }

    try {
      const jid = this.resolveJid(phone, targetCompanyId);
      await session.socket.sendPresenceUpdate('composing', jid);
      return { status: 'success' };
    } catch (error) {
      console.error(`[${targetCompanyId}] Send typing error:`, error);
      return { status: 'error', error };
    }
  }

  /**
   * Get all active sessions info.
   */
  getAllSessions(): { companyId: string; connected: boolean }[] {
    const result: { companyId: string; connected: boolean }[] = [];
    this.sessions.forEach((session, companyId) => {
      result.push({
        companyId,
        connected: session.state.connection === "open",
      });
    });
    return result;
  }
}
