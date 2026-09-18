# Contributing to @agenticnucleus/whatsapp-multitenant

Thank you for your interest in contributing to **@agenticnucleus/whatsapp-multitenant**! We welcome contributions from developers worldwide to build the most resilient, multi-tenant WhatsApp Gateway for AI Agents.

---

## 🧭 Code of Conduct

We are committed to providing a welcoming, inclusive, and harassment-free experience for everyone. Please be respectful and constructive in issues, discussions, and pull requests.

---

## 🛠 Local Development Setup

### 1. Prerequisites
- **Node.js**: v18+ (Node.js 20 LTS recommended)
- **MySQL**: v8.0+ or compatible (MariaDB, Cloud RDS)
- **Git**

### 2. Getting Started
1. **Fork the Repository**: Click the "Fork" button on GitHub.
2. **Clone your fork**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/whatsapp-multitenant.git
   cd whatsapp-multitenant
   ```
3. **Install Dependencies**:
   ```bash
   npm install
   ```
4. **Set Up Environment Variables**:
   Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
   Fill in your local MySQL credentials and test backend URL.

5. **Run in Development Mode**:
   ```bash
   npm run dev
   ```

6. **Build**:
   ```bash
   npm run build
   ```

---

## 🚀 How to Submit a Pull Request

1. **Create a branch**:
   ```bash
   git checkout -b feat/your-feature-name
   # or
   git checkout -b fix/issue-description
   ```
2. **Make your changes**: Keep commits granular, focused, and well-described.
3. **Follow Coding Standards**:
   - Write clean TypeScript with strict typing.
   - Do not commit secrets, tokens, or local `.env` files.
   - Ensure `npm run build` succeeds with zero errors.
4. **Push your branch**:
   ```bash
   git push origin feat/your-feature-name
   ```
5. **Open a Pull Request**:
   - Go to [agenticnucleus/whatsapp-multitenant](https://github.com/agenticnucleus/whatsapp-multitenant)
   - Click "New Pull Request" and complete the [Pull Request Template](.github/PULL_REQUEST_TEMPLATE.md).

---

## 💡 What We Love Contributions For:
- Additional media adapters & audio transcoder helpers (e.g. ffmpeg hooks).
- Alternative session auth adapters (PostgreSQL, Redis, MongoDB).
- Webhook signature security and HMAC verification.
- Unit and integration tests with mock sockets.
- Documentation improvements, multi-language guides, and tutorials.

---

## ⚖️ License
By contributing to this repository, you agree that your contributions will be licensed under the [MIT License](LICENSE).
