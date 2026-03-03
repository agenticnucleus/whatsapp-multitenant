import * as Baileys from "@whiskeysockets/baileys";
import * as qr from "qr-image";
import pino from "pino";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as path from "path";

import LeadExternal from "../../domain/lead-external.repository";

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
      const { useMySQLAuthState } = await import("../auth/mysql.auth");
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
   */
  async startSession(companyId: string): Promise<{ status: string; message: string }> {
    // If session exists and is open, return early
    const existingSession = this.sessions.get(companyId);
    if (existingSession && existingSession.state.connection === "open") {
      return { status: "connected", message: "Session already connected" };
    }

    try {
      const { saveCreds, state } = await this.getAuth(companyId);

      const socket = this.baileys.makeWASocket({
        printQRInTerminal: false,
        browser: ["KindiCoreAI", "Chrome", "1.0.0"],
        version: [2, 3000, 1033893291],
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

      socket.ev.on("connection.update", (update: any) => {
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
            console.log(`[${companyId}] QR code saved to ${this.getQrFile(companyId)}`);
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
          console.log(`[${companyId}] Connection opened`);
        }

        if (connection === "close") {
          sessionInfo.isReady = false;

          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const shouldReconnect = statusCode !== Baileys.DisconnectReason.loggedOut && statusCode !== 405;
          // 405 is Connection Failure, often requires a clean start

          console.log(`[${companyId}] Connection closed. Reason: ${statusCode}, Error: ${lastDisconnect?.error}`);

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
            console.log(`[${companyId}] Session logged out or permanently disconnected`);
            this.sessions.delete(companyId);
            this.emit("disconnected", { companyId, reason: "logged_out" });

            // Cleanup on logout
            try {
              // fs.rmSync... (Deprecated with MySQL)
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
   * Get session status for a company.
   */
  getStatus(companyId: string): { connected: boolean; state: string | null; status: string | null } {
    const session = this.sessions.get(companyId);
    if (!session) {
      return { connected: false, state: null, status: null };
    }
    const connectionState = session.state.connection || null;
    return {
      connected: connectionState === "open",
      state: connectionState,
      status: connectionState, // Alias for Python backend compatibility
    };
  }

  /**
   * Get session status with auto-restore from MySQL.
   * If session is not in memory but credentials exist in MySQL, auto-start the session.
   */
  async getStatusWithAutoRestore(companyId: string): Promise<{ connected: boolean; state: string | null; status: string | null; restoring?: boolean }> {
    // Check if session exists in memory
    const existingSession = this.sessions.get(companyId);
    if (existingSession) {
      const connectionState = existingSession.state.connection || null;
      return {
        connected: connectionState === "open",
        state: connectionState,
        status: connectionState,
      };
    }

    // Session not in memory - check if credentials exist in MySQL
    try {
      const { useMySQLAuthState } = await import("../auth/mysql.auth");
      const { state } = await useMySQLAuthState(companyId);

      // Check if credentials have been paired (me.id exists means device was paired)
      if (state.creds && state.creds.me && state.creds.me.id) {
        // Auto-start session in background (don't wait for it)
        console.log(`[${companyId}] Auto-restoring session from MySQL...`);
        this.startSession(companyId).catch(err => {
          console.error(`[${companyId}] Auto-restore failed:`, err);
        });

        return {
          connected: false,
          state: "restoring",
          status: "restoring",
          restoring: true,
        };
      }
    } catch (error) {
      console.error(`[${companyId}] Error checking stored credentials:`, error);
    }

    // No credentials or not registered
    return { connected: false, state: null, status: null };
  }

  /**
   * Logout and disconnect a session.
   */
  async logout(companyId: string): Promise<{ status: string }> {
    const session = this.sessions.get(companyId);
    if (!session) {
      return { status: "not_found" };
    }
    try {
      await session.socket.logout();
      this.sessions.delete(companyId);
      return { status: "logged_out" };
    } catch (error) {
      console.error(`[${companyId}] Logout error:`, error);
      return { status: "error" };
    }
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
    const targetCompanyId = companyId || "default";
    console.log(`[${targetCompanyId}] Sending message to ${phone}: ${message}`);
    const session = this.sessions.get(targetCompanyId);
    console.log(`[${targetCompanyId}] Connection status: ${session?.state?.connection}`);

    // Relaxed check: Allow sending if session exists, even if state is not explicitly "open" (sometimes it lags)
    if (!session) {
      throw new Error(`Session for ${targetCompanyId} not found`);
    }

    try {
      // Normalize phone number (remove any non-numeric except +)
      const cleanPhone = phone.replace(/[^0-9]/g, "");
      const jid = `${cleanPhone}@s.whatsapp.net`;

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
    const session = this.sessions.get(companyId);

    if (!session || session.state.connection !== "open") {
      throw new Error(`Session for ${companyId} is not connected`);
    }

    try {
      const cleanPhone = phone.replace(/[^0-9]/g, "");
      const jid = `${cleanPhone}@s.whatsapp.net`;

      let messageContent: any = {};

      switch (mediaType) {
        case "image":
          messageContent = { image: { url: mediaUrl }, caption };
          break;
        case "video":
          messageContent = { video: { url: mediaUrl }, caption };
          break;
        case "audio":
          messageContent = { audio: { url: mediaUrl }, mimetype: "audio/mpeg" };
          break;
        case "document":
          messageContent = {
            document: { url: mediaUrl },
            fileName: fileName || "document",
            mimetype: "application/octet-stream",
          };
          break;
      }

      const response = await session.socket.sendMessage(jid, messageContent);
      return response;
    } catch (error) {
      console.error(`[${companyId}] Send media error:`, error);
      throw error;
    }
  }

  /**
   * Get all active sessions info.
   */
  /**
   * Send typing indicator
   */
  async sendTyping({ phone, companyId }: { phone: string; companyId?: string }): Promise<any> {
    const targetCompanyId = companyId || "default";
    const session = this.sessions.get(targetCompanyId);

    if (!session || !session.isReady) {
      // Silent fail or return status
      return { status: "not_connected" };
    }

    try {
      const cleanPhone = phone.replace(/[^0-9]/g, "");
      const jid = `${cleanPhone}@s.whatsapp.net`;
      await session.socket.sendPresenceUpdate('composing', jid);
      return { status: 'success' };
    } catch (error) {
      console.error(`[${targetCompanyId}] Send typing error:`, error);
      return { status: 'error', error };
    }
  }

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
