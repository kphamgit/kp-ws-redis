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

  // 1. Determine the URL: Use RedisCloud in prod, or Localhost in dev
  const redisUrl = process.env.REDISCLOUD_URL || 'redis://127.0.0.1:6379';
  
  // 2. Setup options
  const options = {
      // Redis Cloud handles TLS normally, so we usually don't need 
      // the 'rejectUnauthorized' hack we needed for Heroku's native store.
      // However, keeping a retry strategy is good practice.
      retryStrategy: (times) => Math.min(times * 50, 2000)
  };
  
  const redis = new Redis(redisUrl, options);
  const subscriber = new Redis(redisUrl, options);
  
  redis.on('ready', () => console.log(`🚀 Redis connected to: ${redisUrl}`));

  // Subscribe to the "notifications" channel to receive messages published to that channel
  // from Django
  subscriber.subscribe("notifications", (err, count) => {
    if (err) {
      console.error("Failed to subscribe: ", err);
    } else {
      console.log(`Subscribed to ${count} channel(s). Listening for messages on the 'notifications' channel.`);
    }
  });

  const publisher = new Redis(redisUrl, options);  // For publishing messages or other Redis commands

/*
// Right now, receiving FOUR kinds of messages via this channel from Django:
//    1) live_score (Django processes the live question attemp, calculate live score and publich to Redis)
//    2) live_quiz_id (Django receive an http api call from client to start a live quiz with a quiz_id,
// then it will validate the quiz_id and publish it to Redis if it's valid, so that all clients will know a live quiz has started and what quiz_id it is)
// otherwise, it will send an http error reponse back to the client
//    3) live_question_number (Django receives an http api call from client when a teacher sends
//  live quiz question and (together with quiz_id). Then Django will validate the quiz_id and question_number,
// and publish the live_question_number to Redis if it's valid, so that all clients will know a new live quiz question has been sent out and what the question number is)
//    4) live_question_retrieved. Django receives an http api call with quiz_id and question_number included from client when a
  */
  
subscriber.on("message", (channel, message) => {
  console.log(`Received message from Redis channel ${channel}: ${message}`);
  let parsedMessage;
  try {
    parsedMessage = JSON.parse(message);  // parse message as JSON string into a JavaScript object
    console.log("Parsed message: ", parsedMessage);
    if( parsedMessage.message_type === "live_quiz_id") {
      console.log("Received live_quiz_id message from Redis. quiz_id: ", parsedMessage.content);
    }
    if( parsedMessage.message_type === "live_question_retrieved") {
      console.log("Received live_question_retrieved message from Redis. quiz_id: ", parsedMessage.content.quiz_id, " question_number: ", parsedMessage.content.question_number);
    }
    if (parsedMessage.message_type === "live_score") {
      console.log("Received live_score message from Redis. quiz_id: ", parsedMessage.content.quiz_id, " question_number: ", parsedMessage.content.live_question_number, " score: ", parsedMessage.content.score);
    }

  } catch (e) {
    console.error("Failed to parse message as JSON: ", e);
    return; // Exit the handler if message is not valid JSON
  }

});
  
  

//const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379"; // Use REDIS_URL from environment variable or default to local Redis
// Create two Redis clients: one for subscribing and one for publishing/other commands
//console.log("Connecting to Redis at: ", REDIS_URL);

// Handle WebSocket connections
wss.on("connection", async (ws, req) => {
  const wsURL = req.url;
  console.log("Client connected via native WebSocket url=", wsURL);
  //client connected via native WebSocket url= /teacher/
  // strip leading slash and trailing slash if any
  const user_name = wsURL.replace(/^\/|\/$/g, '');

  // attach user_name to the WebSocket connection object so that it can be accessed
  // in message handlers (including close handler) without having to parse the URL again
    ws.user_name = user_name;

    console.log("*********** User", user_name, "connected. WebSocket URL:", wsURL);
    // send a welcome message to the client when they connect
    // but first, collect all logged in users from Redis and include that in the welcome message
    // so that the client can display a list of currently connected users when they first connect
    try {

    }
    catch (e) {
        console.error("Failed to retrieve logged in users from Redis:", e);
    }

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


  ws.on("message", async (msg) => {
        console.log(`Received message from client: ${msg}`);
        let parsedMsg;
        try {
          parsedMsg = JSON.parse(msg);  // parse msg as JSON string into a JavaScript object
          console.log("Parsed message: ", parsedMsg);
          /*
Parsed message:  {
message_type: 'live_score',
content: { live_question_number: '1', score: 5 },
user_name: 'student1'
}
          */

          message_type = parsedMsg.message_type;
          console.log("Message type: ", message_type);
          if (message_type === "ping") {
              //console.log("Received 'ping' from client. Responding with 'pong'.");
              // you don't have to respond to pings if you don't want to, but it's a common convention to do so
              //ws.send("pong");
          }
          else if (message_type === "chat" || message_type === "live_question_number") {
            // Broadcast chat message to all connected clients
            console.log("receive ", parsedMsg.message_type, ". Broadcasting chat message to all clients.", "message content: ", parsedMsg.content);
            wss.clients.forEach((client) => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                  message_type: parsedMsg.message_type,
                  content: parsedMsg.content,
                  user_name: parsedMsg.user_name,
                }));
              }
            });
          }
          else if (message_type === "live_score") {
            console.log("Received live_score message.", "parsedMessage.content: ", parsedMsg.content);    /*
          Parsed message:  {
            message_type: 'live_score',
            content: { live_question_number: '1', score: 5 },
            user_name: 'student1'
          }
                      */
            const key_for_total_live_score = parsedMsg.user_name + "_total_live_score";
            // save total_live_score in Redis with key "user_name_total_live_score"
            // retrieve current total_live_score from Redis, if any, and add to incoming score
 

            const key = parsedMsg.user_name + "_" + "live_question_number";
            // broadcast live_score and live_question_number to all connected clients
            wss.clients.forEach((client) => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                  message_type: parsedMsg.message_type,
                  content: parsedMsg.content,
                  user_name: parsedMsg.user_name,
                }));
              }
            });

          }
          else if (message_type === "live_quiz_id") {
          // Broadcast chat message to all connected clients
          console.log("********* receive ", parsedMsg.message_type, ". Broadcasting live_quiz_id message to all clients.");
        //save live_quiz_id in Redis with key "live_quiz_id"
   
          }
          else if (message_type === "student_acknowleged_live_question_number") {
            console.log("Received student_acknowleged_live_question_number from ", parsedMsg.user_name, " for question number ", parsedMsg.content);
            const key = parsedMsg.user_name + "_live_question_number";

          }
          //terminate_live_quiz
          else if (message_type === "terminate_live_quiz") {
            // broadcast terminate_live_quiz message to all connected clients
            // so they can clear their UIs
            wss.clients.forEach((client) => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                  message_type: "live_quiz_terminated",
                  content: null, // no content needed for this message type
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
 
  });
  
});

console.log("WebSocket server is up and running on port " + PORT);