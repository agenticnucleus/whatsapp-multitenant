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

## 🤝 Contributing

We love community contributions! If you want to contribute, please check our [Contributing Guide](CONTRIBUTING.md) and use our [PR Template](.github/PULL_REQUEST_TEMPLATE.md).

1. Fork the project.
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`).
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`).
4. Push to the Branch (`git push origin feature/AmazingFeature`).
5. Open a Pull Request.

## ⚖️ License

Distributed under the MIT License. See `LICENSE` for more information.

---

*This is an Open Source library. Please ensure you maintain the original author credits when using or mentioning this architecture.*