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
// Right now, receiving TWO message_types in this channel from Django:
//    1) live_score (Django processes the live question attemp, calculate live score and publich to Redis)
//and 2) live_quiz_id (Django receive an http api call from client to start a live quiz with a quiz_id,
// then it will validate the quiz_id and publish it to Redis if it's valid, so that all clients will know a live quiz has started and what quiz_id it is)
// otherwise, it will send an http error reponse back to the client
//    3) live_question_number (Django receives an http api call from client when a teacher sends 
//  live quiz question and (together with quiz_id). Then Django will validate the quiz_id and question_number, 
// and publish the live_question_number to Redis if it's valid, so that all clients will know a new live quiz question has been sent out and what the question number is)
//    4) live_question_retrieved. Django receives an http api call with quiz_id and question_number included from client when a 

subscriber.on("message", (channel, message) => {
  console.log(`Received message from Redis channel ${channel}: ${message}`);
  /*
Retrieved message from Redis: {"message_type": "live_score", "content": 5, "user_name": "student1"}
 message_type after JSON parsing:  live_score
  */

  // Broadcast the message to all connected WebSocket clients
  console.log(`Broadcasting message  ${message} to all connected WebSocket clients.`);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });

  // Use the publisher client to save the message to Redis
  /*
  publisher.set(`message`, message, (err) => {
    if (err) {
      console.error("Failed to save message to Redis:", err);
    } else {
      console.log("Message saved to Redis.");
    }
  });
  */

  /*
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
  */
  
});

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

    // send a welcome message to the client when they connect
    // but first, collect all logged in users from Redis and include that in the welcome message
    // so that the client can display a list of currently connected users when they first connect
    try {
      const loggedInUsers = await publisher.lrange("logged_in_users", 0, -1);
      //console.log("Logged in users retrieved from Redis:", loggedInUsers);
  
      // Filter out the current user from the list of other logged-in users
      const other_logged_in_users = loggedInUsers.filter((loggedInUser) => loggedInUser !== user_name);
      //console.log("***** Other logged in users: ", other_logged_in_users);
  
      const [quizId, liveQuestionNumber, studentsLiveQuestionNumbers,  liveTotalScore, ] = await Promise.all([
        publisher.get(`live_quiz_id`), // Get quiz_id
        publisher.get(`${user_name}_live_question_number`), // Get live_question_number
        // get all live_question_number keys, in case other users are in the middle of a quiz too, so that this user can also see their progress if they are
        publisher.keys("*_live_question_number").then(keys => {
          return Promise.all(keys.map(key => publisher.get(key).then(value => ({ key, value }))));
        }).then(results => {
          //console.log("All live_question_number keys and values: ", results);
          // include all of them in the welcome message,
          return results;
        }),
        publisher.get(`${user_name}_total_live_score`), // Get live_total_score
      ]);

      console.log("Retrieved all students doing live quiz: ", studentsLiveQuestionNumbers);
      /*
Retrieved all students doing live quiz:  [
  { key: 'student1_live_question_number', value: '1' },
  { key: 'student2_live_question_number', value: '1' }
]
      */

      let pending_data = {
        live_quiz_id: quizId || null,
        live_question_number: liveQuestionNumber || null,
        total_live_score: liveTotalScore || null,
        students_live_question_numbers: studentsLiveQuestionNumbers.length > 0 ? studentsLiveQuestionNumbers : null,
      } ;

      // clear live_question_number from Redis after retrieving it
      // so that this student will start over
      await publisher.del(`${user_name}_live_question_number`);

      if (Object.values(pending_data).every(value => value === null)) {
        pending_data = null; // Set to null if all values are null
      }
      // Send a welcome message to the client with all the retrieved data
      const welcomeMessage = JSON.stringify({
        message_type: "welcome_message",
        content: `Welcome ${user_name} to the WebSocket server!`,
        user_name: user_name,
        other_connected_users: other_logged_in_users,
        pending_data: pending_data,
      });
  
      ws.send(welcomeMessage); // Send to this client only

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


  ws.on("message", async (msg) => {
        console.log(`Received message from client: ${msg}`);
        let parsedMsg;
        try {
          parsedMsg = JSON.parse(msg);  // parse msg as JSON string into a JavaScript object
          //console.log("Parsed message: ", parsedMsg);
          /*
Parsed message:  {
message_type: 'live_score',
content: { live_question_number: '1', score: 5 },
user_name: 'student1'
}
          */

          message_type = parsedMsg.message_type;
          //console.log("Message type: ", message_type);
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
          //terminate_live_quiz
          else if (message_type === "terminate_live_quiz") {
            console.log("Received terminate_live_quiz message from ", parsedMsg.user_name);
            // use await to delete live_quiz_id from Redis
            await publisher.del("live_quiz_id");
            console.log("live_quiz_id deleted from Redis.");
            // delete all keys matching "*_live_question_number"
            const keys = await publisher.keys("*_live_question_number");
            for (const key of keys) {
              await publisher.del(key);
              console.log("Deleted key from Redis: ", key);
            }
            // delete all keys matching "*_total_live_score"
            const score_keys = await publisher.keys("*_total_live_score");
            for (const key of score_keys) {
              await publisher.del(key);
              console.log("Deleted key from Redis: ", key);
            }
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