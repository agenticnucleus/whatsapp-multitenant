import { ContainerBuilder } from "node-dependency-injection";
import * as Baileys from "@whiskeysockets/baileys";
import pino from "pino";
import { LeadCreate } from "../application/lead.create";
import LeadCtrl from "./controller/lead.ctrl";
import SessionCtrl from "./controller/session.ctrl";
import MetaRepository from "./repositories/meta.repository";
import MockRepository from "./repositories/mock.repository";
import TwilioService from "./repositories/twilio.repository";
import WsTransporter from "./repositories/ws.external";
import { VenomTransporter } from "./repositories/venom.repository";
import { BaileysTransporter } from "./repositories/baileys.repository";

const container = new ContainerBuilder();

/**
 * Initialize WhatsApp multi-tenant transporter
 */
container.register("ws.transporter", BaileysTransporter);
const wsTransporter = container.get<BaileysTransporter>("ws.transporter");
// Auto-initialize sessions
wsTransporter.initialize();

// Listen for incoming messages and send to Python backend
import axios from "axios";
wsTransporter.on("message", async (data) => {
  try {
    const key = data.message.key;
    if (key.remoteJid === "status@broadcast") {
      return; // Ignore status updates entirely
    }

    console.log("!! [DEBUG] MSG RECEIVED IN NODE !!", JSON.stringify(key));
    // Determine backend URL (default to localhost:5000 for Python Flask)
    const backendUrl = process.env.BACKEND_URL || "http://127.0.0.1:5000";
    console.log(`[${data.companyId}] Forwarding message to backend: ${backendUrl}/webhooks/whatsapp`);

    // Extract content for Python backend (Simple Adapter Pattern)
    const msgContent = data.message.message;
    if (!msgContent) return;

    const textBody = msgContent.conversation || msgContent.extendedTextMessage?.text || "";
    // Fix for LID addressing: logic to prefer phone number over LID
    let fromJid = key.remoteJid;
    const keyAny = key as any; // Cast to access custom/undocumented properties seen in logs
    if (keyAny.remoteJidAlt && fromJid?.endsWith("@lid")) {
      fromJid = keyAny.remoteJidAlt;
      console.log(`[${data.companyId}] Swapped LID for Phone Number: ${key.remoteJid} -> ${fromJid}`);
    }

    const fromPhone = fromJid?.split('@')[0] || "";

    // Detect document/media attachments
    let attachment: any = null;
    const docMsg = msgContent.documentMessage || msgContent.documentWithCaptionMessage?.message?.documentMessage;
    if (docMsg) {
      attachment = {
        type: 'document',
        mimetype: docMsg.mimetype || 'application/octet-stream',
        filename: docMsg.fileName || docMsg.title || 'document',
        caption: docMsg.caption || msgContent.documentWithCaptionMessage?.message?.documentMessage?.caption || '',
      };
      console.log(`[${data.companyId}] Document attachment detected: ${attachment.filename} (${attachment.mimetype})`);

      // Download and save the document for backend processing
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
          const safeName = `${Date.now()}_${attachment.filename.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
          const filePath = path.default.join(tmpDir, safeName);
          fs.default.writeFileSync(filePath, stream as Buffer);
          attachment.local_path = filePath;
          console.log(`[${data.companyId}] Document saved to: ${filePath}`);
        }
      } catch (dlErr: any) {
        console.error(`[${data.companyId}] Failed to download document: ${dlErr.message}`);
      }
    }

    // Only skip if NO text AND NO attachment
    if (!textBody && !attachment) return;

    const payload: any = {
      companyId: data.companyId,
      from: fromPhone,
      message: textBody || (attachment ? `[Archivo enviado: ${attachment.filename}]` : ''),
      messageId: key.id,
    };

    // Attach document metadata if present
    if (attachment) {
      payload.attachment = attachment;
    }

    try {
      await axios.post(`${backendUrl}/webhooks/whatsapp`, payload);
      // console.log(`[${data.companyId}] Webhook request sent successfully`);
    } catch (axiosError: any) {
      if (axiosError.response) {
        console.error(`[${data.companyId}] Webhook server responded with status:`, axiosError.response.status);
        console.error(`[${data.companyId}] Response data:`, axiosError.response.data);
      } else if (axiosError.request) {
        console.error(`[${data.companyId}] No response received from webhook server:`, axiosError.message);
      } else {
        console.error(`[${data.companyId}] Webhook error:`, axiosError.message);
      }
    }
  } catch (error: any) {
    console.error("Failed to process message:", error.message);
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

