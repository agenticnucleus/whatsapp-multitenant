# Multi-tenant WhatsApp Library for AI Agents

Powered by **WEBLIFETECH** and designed for **AI Agent** orchestrations por @jonnathanypg.

## 👨‍💻 Author and Creator

**Jonnathan Peña**
* Lead Architect & Original Creator
* [GitHub](https://github.com/jonnathanypg)
* [LinkedIn](https://www.linkedin.com/in/jonnathanypg/)

---

## 🚀 Features

- **Multi-tenant**: Handle multiple WhatsApp sessions simultaneously.
- **AI Ready**: Easy integration with AI agent backends via webhooks.
- **Stable**: Validated for production SaaS environments.
- **Persistence**: MySQL support for session management.
- **Microservice & Library**: Can be run as a standalone service or imported as a library.

## 📦 Installation

```bash
npm install @agenticnucleus/whatsapp-multitenant
```

## 🛠 Usage (Library Mode)

```typescript
import { BaileysTransporter } from '@agenticnucleus/whatsapp-multitenant';

const transporter = new BaileysTransporter();
transporter.initialize();

transporter.on('message', (message) => {
    console.log('Message received:', message);
});
```

## 🌐 Usage (Microservice Mode)

1. Clone the repository.
2. Initialize environment variables: `cp .env.example .env`.
3. Start the service:
```bash
npm install
npm run dev
```

## 📄 License

This project is licensed under the [MIT License](LICENSE).

---

*This is an Open Source library. Please ensure you maintain the original author credits when using or mentioning this architecture.*