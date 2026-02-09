const Redis = require("ioredis");

const WebSocket = require("ws");
//const wss = new WebSocket.Server({ port: 8080 });
const PORT = process.env.PORT || 8080; // Use PORT from environment variable or default to 8080
const wss = new WebSocket.Server({ port: PORT }); // either PORT from .env or 
// assigned automatically by hosting provider (e.g., Heroku) when deployed

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379"; // Use REDIS_URL from environment variable or default to local Redis
// Create two Redis clients: one for subscribing and one for publishing/other commands
const subscriber = new Redis(REDIS_URL); // For subscribing to channels
const publisher = new Redis(REDIS_URL);  // For publishing messages or other Redis commands

// Subscribe to the "notifications" channel
subscriber.subscribe("notifications", (err, count) => {
  if (err) {
    console.error("Failed to subscribe: ", err);
  } else {
    console.log(`Subscribed to ${count} channel(s). Listening for updates on the 'notifications' channel.`);
  }
});

// Listen for messages on the "notifications" channel
subscriber.on("message", (channel, message) => {
  console.log(`Received message from Redis channel ${channel}: ${message}`);

  // Broadcast the message to all connected WebSocket clients
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });

  // Use the publisher client to save the message to Redis
  publisher.set(`message`, message, (err) => {
    if (err) {
      console.error("Failed to save message to Redis:", err);
    } else {
      console.log("Message saved to Redis.");
    }
  });
  publisher.get("message", (err, result) => {
    if (err) {
      console.error("Failed to retrieve message from Redis:", err);
    } else {
      console.log("Retrieved message from Redis:", result);
    }
  });
});

// Handle WebSocket connections
wss.on("connection", (ws) => {
  console.log("Client connected via native WebSocket.");
  ws.send(JSON.stringify("Welcome to the WebSocket server!"));


  /*
  ws.on("message", (msg) => {
    console.log(`Got a message: ${msg}`);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  });
  */


  ws.on("close", () => {
    console.log("Client disconnected.");
  });
});

console.log("WebSocket server is up and running on port " + PORT);