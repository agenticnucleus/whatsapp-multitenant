import { Router } from "express";
import SessionCtrl from "../controller/session.ctrl";
import container from "../ioc";

const router = Router();
const sessionCtrl: SessionCtrl = container.get("session.ctrl");

router.post("/init", sessionCtrl.initSession);
router.get("/qr/:companyId", sessionCtrl.getQr);
router.get("/status/:companyId", sessionCtrl.getStatus);
router.get("/status-restore/:companyId", sessionCtrl.getStatusWithRestore);
router.post("/logout", sessionCtrl.logout);
router.get("/list", sessionCtrl.listSessions);

export { router };
