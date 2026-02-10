const Redis = require("ioredis");
require("dotenv").config(); // Load environment variables from .env file

const WebSocket = require("ws");
//const wss = new WebSocket.Server({ port: 8080 });
const PORT = process.env.PORT || 8080; // Use PORT from environment variable or default to 8080
const wss = new WebSocket.Server({ port: PORT }); // either PORT from .env or 
// assigned automatically by hosting provider (e.g., Heroku) when deployed

// Create Redis clients with TLS options
/*
const redisOptions = {
    tls: {
      rejectUnauthorized: false, // Allow self-signed certificates
    },
  };
  */

  console.log("Running in environment: ", process.env.NODE_ENV);

  const redisOptions = process.env.NODE_ENV === "production" ? {
    tls: {
      rejectUnauthorized: false, // Allow self-signed certificates in production
    },
    connectTimeout: 20000, // Increase timeout to 20 seconds
  } : {}; // No TLS options in development
  
  

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379"; // Use REDIS_URL from environment variable or default to local Redis
// Create two Redis clients: one for subscribing and one for publishing/other commands
console.log("Connecting to Redis at: ", REDIS_URL);

const subscriber = new Redis(REDIS_URL, redisOptions); // For subscribing to channels
const publisher = new Redis(REDIS_URL, redisOptions);  // For publishing messages or other Redis commands

subscriber.on("error", (err) => {
    console.error("Redis subscriber error: ", err);
    }
);

publisher.on("error", (err) => {
    console.error("Redis publisher error: ", err);
    });

// Subscribe to the "notifications" channel to receive messages published to that channel
// from Django
subscriber.subscribe("notifications", (err, count) => {
  if (err) {
    console.error("Failed to subscribe: ", err);
  } else {
    console.log(`Subscribed to ${count} channel(s). Listening for messages on the 'notifications' channel.`);
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
      // everything from Redis is a JSON string. So you need to parse it back into a JavaScript object before you can access its properties.
      console.log(" message_type after JSON parsing: ", JSON.parse(result).message_type);
      // use wss.clients to broadcast the message to all connected WebSocket clients
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
            client.send(result); // send the raw JSON string to clients
            }
        });
    }
  });
  
});

// Handle WebSocket connections
wss.on("connection", (ws, req) => {
  const wsURL = req.url;
  console.log("Client connected via native WebSocket url=", wsURL);
  //client connected via native WebSocket url= /teacher/
  // strip leading slash and trailing slash if any
  const user_name = wsURL.replace(/^\/|\/$/g, '');
  console.log("Extracted user_name: ", user_name);

  // attach user_name to the WebSocket connection object so that it can be accessed
  // in message handlers (including close handler) without having to parse the URL again
    ws.user_name = user_name;

    // send a welcome message to the client when they connect
    // but first, collect all logged in users from Redis and include that in the welcome message
    // so that the client can display a list of currently connected users when they first connect

    publisher.lrange("logged_in_users", 0, -1, (err, loggedInUsers) => {
        if (err) {
            console.error("Failed to retrieve logged in users from Redis:", err);
        }
        else {
            console.log("Logged in users retrieved from Redis:", loggedInUsers);
            // put all logged in users except the current user into the other_logged_in_users array
            const other_logged_in_users = loggedInUsers.filter((loggedInUser) => loggedInUser !== user_name);
            console.log("***** Other logged in users: ", other_logged_in_users);
            // send a welcome message to the client that includes their user_name and a list of other currently logged in users (if any)
            const welcomeMessage = JSON.stringify({
                message_type: "welcome_message",
                content: `Welcome ${user_name} to the WebSocket server!`,
                user_name: user_name,
                other_connected_users: other_logged_in_users // you can also include a list of other connected users if you want
              })
        
          //ws.send(JSON.stringify(`Welcome ${user_name} to the WebSocket server!`));
            ws.send(welcomeMessage); // send to this client only
        }
    });

    /*
    publisher.lrange("logged_in_users", 0, -1, (err, loggedInUsers) => {
        if (err) {
            console.error("Failed to retrieve logged in users from Redis:", err);
        } else {
            console.log("Logged in users retrieved from Redis:", loggedInUsers);
            // put all logged in users except the current user into the other_logged_in_users array
            loggedInUsers.forEach((loggedInUser) => {
                if (loggedInUser !== user_name) {
                    other_logged_in_users.push(loggedInUser);
                }   
            });
        }
    });
    */
   /*
    console.log("***** Other logged in users: ", other_logged_in_users);
    // send a welcome message to the client that includes their user_name and a list of other currently logged in users (if any)
    const welcomeMessage = JSON.stringify({
        message_type: "welcome_message",
        content: `Welcome ${user_name} to the WebSocket server!`,
        user_name: user_name,
        other_connected_users: other_logged_in_users // you can also include a list of other connected users if you want
      })

  //ws.send(JSON.stringify(`Welcome ${user_name} to the WebSocket server!`));
    ws.send(welcomeMessage); // send to this client only
*/
  const userJoinedMessage = JSON.stringify({
    message_type: "another_user_joined",
    user_name: user_name
  })

  // use wss.clients to broadcast a message to all connected clients that a new user has joined
  // except the new user themselves (since they already got a welcome message)
  console.log(`Broadcasting to all clients that user ${user_name} has joined the session.`);
    wss.clients.forEach((client) => {
        if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(userJoinedMessage);
        }   
    });

  // log information about the connected client
  // use publisher to save user_name to a list of logged in users in Redis
  /*
    publisher.lpush("logged_in_users", user_name, (err) => {
        if (err) {
            console.error("Failed to save logged in user to Redis:", err);
        } else {
            console.log(`Logged in user ${user_name} saved to Redis.`);
        }
    });
*/

// Check if the user_name is already in the list before adding it
publisher.lrange("logged_in_users", 0, -1, (err, loggedInUsers) => {
    if (err) {
      console.error("Failed to retrieve logged-in users from Redis:", err);
    } else if (!loggedInUsers.includes(user_name)) {
      // Add the user_name to the list only if it's not already present
      publisher.lpush("logged_in_users", user_name, (err) => {
        if (err) {
          console.error("Failed to save logged-in user to Redis:", err);
        } else {
          console.log(`Logged in user ${user_name} saved to Redis.`);
        }
      });
    } else {
      console.log(`User ${user_name} is already logged in.`);
    }
  });


  ws.on("message", (msg) => {
        console.log(`Received message from client: ${msg}`);
        let parsedMsg;
        try {
            parsedMsg = JSON.parse(msg);
            message_type = parsedMsg.message_type;
            if (message_type === "ping") {
                console.log("Received 'ping' from client. Responding with 'pong'.");
                // you don't have to respond to pings if you don't want to, but it's a common convention to do so
                //ws.send("pong");
        }
        else if (message_type === "chat") {
            // Broadcast chat message to all connected clients
            console.log("Broadcasting chat message to all clients.");
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        message_type: "chat",
                        content: parsedMsg.content,
                        user_name: parsedMsg.user_name,
                    }));
                }
            });
        }
        else if (message_type === "quiz_id") {
            // Broadcast chat message to all connected clients
            // save quiz_id to Redis so that it can be retrieved by clients when they connect or refresh

            console.log("Broadcasting quiz_id to all clients.");
            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                        message_type: "chat",
                        content: parsedMsg.content,
                        user_name: parsedMsg.user_name,
                    }));
                }
            });
        }
        } catch (e) {
            console.error("Failed to parse message as JSON: ", e);
            return; // Exit the handler if message is not valid JSON
        }

    
    });

    /*
Received message from client: {"message_type":"chat","content":"ww","user_name":"student1"}
    */


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
    console.log("WebSocket connection closed by client. url =", wsURL);
    console.log("Client disconnected. User", ws.user_name);
    // note: user_name is attached to the WebSocket connection object in the connection handler, 
    // so we can access it here without having to parse the URL again
    // remove user_name from the list of logged in users in Redis
    publisher.lrem("logged_in_users", 0, ws.user_name, (err) => {
        if (err) {
            console.error("Failed to remove logged in user from Redis:", err);
        } else {
            console.log(`Logged in user ${ws.user_name} removed from Redis.`);
        }
    });
  });
  
});

console.log("WebSocket server is up and running on port " + PORT);