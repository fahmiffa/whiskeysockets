const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
} = require("@whiskeysockets/baileys");

process.setMaxListeners(0);

const http = require("http");
const express = require("express");
const bodyParser = require("body-parser");
const port = 9000;
const qrcode = require("qrcode");
const pino = require("pino");

const app = express();
const server = http.createServer(app);
const path = require("path");
const fs = require("fs");

const EventEmitter = require("events");
const qrEmitter = new EventEmitter();

// const socketIO = require("socket.io");
// const io = socketIO(server);
// config cors
const io = require("socket.io")(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

const { body, validationResult } = require("express-validator");

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

async function auth(sta) {
  const sessionPath = path.join(__dirname, `sessions/${sta}`);
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  const sock = makeWASocket({
    auth: state,
    defaultQueryTimeoutMs: undefined,
    logger: pino({ level: "fatal" }),
    browser: ["FFA", "SAFARI", "1.0"],
    printQRInTerminal: false,
  });

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrEmitter.emit("qr", qr);
    }

    if (connection === "close") {
      const statusCode = lastDisconnect.error?.output?.statusCode;
      isLoggedOut = statusCode === DisconnectReason.loggedOut;
      console.log("logout", isLoggedOut);
      if (isLoggedOut) {
        remove(sta);
        auth(sta);
        qrEmitter.emit("logout", isLoggedOut);
      } else {
        qrEmitter.emit("login", true);
      }

      if (!isLoggedOut) {
        auth(sta);
      }

      console.log(DisconnectReason);
    }
  });
  sock.ev.on("creds.update", saveCreds);
  return sock;
}

async function send(sta, msg, to) {
  const sessionPath = path.join(__dirname, `sessions/${sta}`);
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  const sock = makeWASocket({
    auth: state,
    defaultQueryTimeoutMs: undefined,
    logger: pino({ level: "fatal" }),
    browser: ["FFA", "SAFARI", "1.0"],
  });

  sock.ev.on("connection.update", (update) => {
    const { connection } = update;
    if (connection === "open") {
      const id = to + "@s.whatsapp.net";
      sock.sendMessage(id, {
        text: msg,
      });
    }
  });

  sock.ev.on("creds.update", saveCreds);
  return sock;
}

async function remove(sta) {
  const sessionPath = path.join(__dirname, `sessions/${sta}`);
  fs.rm(sessionPath, { recursive: true, force: true }, (err) => {
    if (err) {
      console.error("Error removing path:", err);
      return;
    } else {
      console.log("remove");
    }
  });
}

io.on("connection", (socket) => {
  socket.on("StartConnection", async (device) => {
    const sock = await auth(device);
    if (typeof sock.user !== "undefined") {
      console.log("user ", sock.user);
      socket.emit("ready", "Whatsapp connected");
    } else {
      socket.emit("message", "QR Code received, scan please!");
      qrEmitter.on("qr", (qr) => {
        qrcode.toDataURL(qr, function (err, url) {
          socket.emit("qr", url);
        });
      });
    }
  });

  qrEmitter.on("logout", (qr) => {
    socket.emit("message", "Device Disconnect");
  });

  qrEmitter.on("login", (qr) => {
    socket.emit("ready", "Whatsapp connected");
  });

  socket.on("LogoutDevice", (device) => {
    remove(device);
    socket.emit("message", "logout device " + device);
  });
});

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/core/home.html");
});

app.get("/device", (req, res) => {
  res.sendFile(__dirname + "/core//device.html");
});

app.get("/scan/:id", (req, res) => {
  res.sendFile(__dirname + "/core//index.html");
});

app.post(
  "/send",
  [
    body("number").notEmpty(),
    body("message").notEmpty(),
    body("to").notEmpty(),
    body("type").notEmpty(),
  ],
  async (req, res) => {
    const errors = validationResult(req).formatWith(({ msg }) => {
      return msg;
    });

    if (!errors.isEmpty()) {
      return res.status(422).json({
        status: false,
        message: errors.mapped(),
      });
    } else {
      var number = req.body.number;
      var to = req.body.to;
      var type = req.body.type;
      var msg = req.body.message;

      const sessionPath = path.join(__dirname, `sessions/${number}`);
      if (fs.existsSync(sessionPath)) {
        send(number, msg, to);
        res.end(
          JSON.stringify({
            status: true,
            message: "success",
          })
        );
      } else {
        res.writeHead(401, {
          "Content-Type": "application/json",
        });
        res.end(
          JSON.stringify({
            status: false,
            message: "Please scan the QR before use the API",
          })
        );
      }
    }
  }
);

app.post("/device", (req, res) => {
  const no = req.body.device;
  res.redirect("/scan/" + no);
});

server.listen(port, function () {
  console.log("App running on : " + port);
});
