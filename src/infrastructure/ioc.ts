import { ContainerBuilder } from "node-dependency-injection";
import * as Baileys from "@whiskeysockets/baileys";
import pino from "pino";
import axios from "axios";
import { LeadCreate } from "../application/lead.create";
import LeadCtrl from "./controller/lead.ctrl";
import SessionCtrl from "./controller/session.ctrl";
import MockRepository from "./repositories/mock.repository";
import { BaileysTransporter } from "./repositories/baileys.repository";

const container = new ContainerBuilder();

/**
 * Initialize WhatsApp multi-tenant transporter
 */
container.register("ws.transporter", BaileysTransporter);
const wsTransporter = container.get<BaileysTransporter>("ws.transporter");
// Auto-initialize sessions from DB on startup
wsTransporter.initialize();

// Listen for incoming messages and forward to backend webhook
wsTransporter.on("message", async (data) => {
  try {
    const key = data.message.key;
    if (key.remoteJid === "status@broadcast") {
      return; // Ignore status updates entirely
    }

    console.log("!! [DEBUG] MSG RECEIVED IN NODE !!", JSON.stringify(key));
    // Determine backend URL (default to localhost:5000 for Python/AI Agent backend)
    const backendUrl = process.env.BACKEND_URL || "http://127.0.0.1:5000";
    const webhookPath = process.env.WEBHOOK_PATH || "/webhooks/whatsapp";
    const targetUrl = `${backendUrl.replace(/\/$/, '')}${webhookPath.startsWith('/') ? webhookPath : `/${webhookPath}`}`;
    console.log(`[${data.companyId}] Forwarding message to backend: ${targetUrl}`);

    // Extract content for Backend
    const msgContent = data.message.message;
    if (!msgContent) return;

    const textBody = msgContent.conversation || msgContent.extendedTextMessage?.text || "";
    
    // Fix for LID addressing: logic to prefer phone number over LID
    let fromJid = key.remoteJid;
    const keyAny = key as any;
    if (keyAny.remoteJidAlt && fromJid?.endsWith("@lid")) {
      fromJid = keyAny.remoteJidAlt;
      console.log(`[${data.companyId}] Swapped LID for Phone Number: ${key.remoteJid} -> ${fromJid}`);
    }

    const fromPhone = fromJid?.split('@')[0] || "";

    // Detect document, image, audio attachments
    let attachment: any = null;
    const docMsg = msgContent.documentMessage || msgContent.documentWithCaptionMessage?.message?.documentMessage;
    const imgMsg = msgContent.imageMessage;
    const audioMsg = msgContent.audioMessage;

    if (docMsg || imgMsg || audioMsg) {
      const targetMsg = docMsg || imgMsg || audioMsg;
      attachment = {
        type: docMsg ? 'document' : (imgMsg ? 'image' : 'audio'),
        mimetype: targetMsg.mimetype || (docMsg ? 'application/octet-stream' : (imgMsg ? 'image/jpeg' : 'audio/ogg; codecs=opus')),
        filename: targetMsg.fileName || targetMsg.title || (docMsg ? 'document' : (imgMsg ? 'image.jpg' : `wa_audio_${Date.now()}.ogg`)),
        caption: targetMsg.caption || msgContent.documentWithCaptionMessage?.message?.documentMessage?.caption || '',
      };
      console.log(`[${data.companyId}] ${attachment.type} attachment detected: ${attachment.filename}`);

      // Download and save attachment for backend processing
      try {
        const stream = await Baileys.downloadMediaMessage(
          data.message,
          "buffer",
          {},
          // @ts-ignore - logger typing mismatch
          { logger: pino({ level: "silent" }), reuploadRequest: wsTransporter["sessions"]?.get(data.companyId)?.socket?.updateMediaMessage }
        );
        if (stream) {
          const fs = await import("fs");
          const path = await import("path");
          const tmpDir = path.default.join(process.cwd(), "tmp", "uploads");
          if (!fs.default.existsSync(tmpDir)) {
            fs.default.mkdirSync(tmpDir, { recursive: true });
          }
          const safeName = (docMsg || imgMsg)
            ? `${Date.now()}_${attachment.filename.replace(/[^a-zA-Z0-9_.-]/g, '_')}`
            : attachment.filename;
          const filePath = path.default.join(tmpDir, safeName);
          fs.default.writeFileSync(filePath, stream as Buffer);
          attachment.local_path = filePath;
          console.log(`[${data.companyId}] Attachment saved to: ${filePath}`);
        }
      } catch (dlErr: any) {
        console.error(`[${data.companyId}] Failed to download attachment: ${dlErr.message}`);
      }
    }

    // Only skip if NO text AND NO attachment
    if (!textBody && !attachment) return;

    const payload: any = {
      companyId: data.companyId,
      from: fromPhone,
      fromJid: key.remoteJid,
      remoteJid: key.remoteJid,
      remoteJidAlt: keyAny.remoteJidAlt,
      fromName: data.message.pushName || "",
      message: textBody || (attachment ? `[Archivo enviado: ${attachment.filename}]` : ''),
      messageId: key.id,
      rawMessage: data.message,
    };

    if (attachment) {
      payload.attachment = attachment;
    }

    try {
      await axios.post(targetUrl, payload);
    } catch (axiosError: any) {
      if (axiosError.response) {
        console.error(`[${data.companyId}] Webhook server responded with status:`, axiosError.response.status);
      } else {
        console.error(`[${data.companyId}] Webhook error:`, axiosError.message);
      }
    }
  } catch (error: any) {
    console.error("Failed to process incoming message:", error.message);
  }
});

container.register("db.repository", MockRepository);
const dbRepository = container.get("db.repository");

container
  .register("lead.creator", LeadCreate)
  .addArgument([dbRepository, wsTransporter]);

const leadCreator = container.get("lead.creator");

container.register("lead.ctrl", LeadCtrl).addArgument(leadCreator);

/**
 * Session controller for multi-tenant management
 */
container.register("session.ctrl", SessionCtrl).addArgument(wsTransporter);

export default container;
