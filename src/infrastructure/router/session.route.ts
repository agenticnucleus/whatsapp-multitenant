import { Router } from "express";
import SessionCtrl from "../controller/session.ctrl";
import container from "../ioc";

const router: Router = Router();

/**
 * Session management routes for multi-tenant WhatsApp API
 */
const sessionCtrl: SessionCtrl = container.get("session.ctrl");

// POST /session/init - Initialize a new session
router.post("/init", sessionCtrl.initSession);

// GET /session/qr/:companyId - Get QR code SVG
router.get("/qr/:companyId", sessionCtrl.getQr);

// GET /session/status/:companyId - Get session status
router.get("/status/:companyId", sessionCtrl.getStatus);

// POST /session/logout - Logout and disconnect session
router.post("/logout", sessionCtrl.logout);

// GET /session/list - List all active sessions
router.get("/list", sessionCtrl.listSessions);

export { router };
