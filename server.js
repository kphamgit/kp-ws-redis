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

subscriber.on("message", async (channel, message) => {
  console.log(`Received message from Redis channel ${channel}: ${message}`);
  /*
Retrieved message from Redis: {"message_type": "live_score", "content": 5, "user_name": "student1"}
"message_type": "live_quiz_id", "content": 1, "quiz_name": "Quiz 1"}
edis channel notifications: {"message_type": "live_question_number", "content": 1}
Broadcasting message  {"message_type": "live_question_number", "content": 1} to all connected WebSocket clients.
Received message from Redis channel notifications: {"message_type": "live_question_retrieved", "content": 1, "user_name": "student1"}
Broadcasting message  {"message_type": "live_question_retrieved", "content": 1, "user_name": "student1"} to all connected WebSocket clients.
Received message from client: {"message_type":"ping"}
  */
 console.log("Parsing message as JSON string into a JavaScript object.");
  let parsedMessage;
  try {
    parsedMessage = JSON.parse(message);  // parse message as JSON string into a JavaScript object
    console.log("Parsed message: ", parsedMessage);
  } catch (e) {
    console.error("Failed to parse message as JSON: ", e);
    return; // Exit the handler if message is not valid JSON
  }

  if(parsedMessage.message_type === "live_question_retrieved") {
    console.log("Received live_question_retrieved message. Attempting to retrieve user data from Redis for user: ", parsedMessage.user_name);
    //const user_name = message.user_name;
    try {
      // Syntax: JSON.GET <key> [path]
      console.log("on live_question_retrieved, trying to retrieve user data from Redis for user: ", parsedMessage.user_name);
      const userData = await publisher.call('JSON.GET', `user:${parsedMessage.user_name}`, '$'); // '$' retrieves the entire JSON object
      if (userData) {
        // use JSON.SET to update live_question_number for this user in Redis
        const result = await publisher.call(
          'JSON.SET',
          `user:${parsedMessage.user_name}`,
          '$.live_question_number',
          JSON.stringify(String(parsedMessage.content)) // store as string
        );
        if (result === 'OK') {
          console.log(`Successfully updated live_question_number for user ${parsedMessage.user_name} to ${parsedMessage.content}`);

        } else {
          console.error(`Failed to update live_question_number for user ${parsedMessage.user_name}. Result: ${result}`);
        }
        //const parsedUserData = JSON.parse(userData); // Parse the JSON string into a JavaScript object
        //console.log("on live_question_retrieved, retrieved user data from Redis:", parsedUserData);
        //live_question_retrieved, retrieved user data from Redis: [ { name: 'student1', live_question_number: '1' } ]
      } else {
        console.log("No data found for key 'user:2'");
      }
    } catch (err) {
      console.error("Failed to retrieve user data from Redis:", err);
    }
  }

  if (parsedMessage.message_type === "live_score") {
      //parseMsg's content is the live score.
      // use JSON.GET/SET to update the current live_total_score for this user from Redis,
      let currentTotalScore;
      try {
        // retrieve current live_total_score for this user from Redis
        currentTotalScore = await publisher.call('JSON.GET', `user:${parsedMessage.user_name}`, '$.live_total_score');
        const parsedCurrentTotalScore = JSON.parse(currentTotalScore);
        //console.log(`Retrieved current live_total_score for user ${parsedMessage.user_name}: ${parsedCurrentTotalScore}`);
        if (Number(parsedCurrentTotalScore) === 999) {
          currentTotalScore = "0"; // default to 0 if currentTotalScore is the initial dummy value
        }
      }
      catch (err) {
        currentTotalScore = "0"; // default to 0 if error occurs
      }

      try {
        const newTotalScore = Number(JSON.parse(currentTotalScore)) + Number(parsedMessage.content); // add the new live score to the current total score
        //console.log(`Updating live_total_score for user ${parsedMessage.user_name} from ${currentTotalScore} to ${newTotalScore}`);
        const result = await publisher.call(
          'JSON.SET',
          `user:${parsedMessage.user_name}`,
          '$.live_total_score',
          JSON.stringify(String(newTotalScore)) // store as string
        );
        if (result === 'OK') {
          console.log(`Successfully updated live_total_score for user ${parsedMessage.user_name} to ${newTotalScore}`);
        } else {
          console.error(`Failed to update live_total_score for user ${parsedMessage.user_name}. Result: ${result}`);
        }
      }
      catch (err) {
        console.error("Failed to update live_total_score in Redis:", err);
      }
  }

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
});

// Handle WebSocket connections
wss.on("connection", async (ws, req) => {
  const wsURL = req.url;
  console.log("Client connected via native WebSocket url=", wsURL);
  //client connected via native WebSocket url= /teacher/
  // strip leading slash and trailing slash if any
  const user_name = wsURL.replace(/^\/|\/$/g, '');
  console.log(" ********** USER ", user_name, " connected. Attaching user_name to WebSocket connection object for future reference in message handlers and close handler.");
  // attach user_name to the WebSocket connection object so that it can be accessed
  // in message handlers (including close handler) without having to parse the URL again

  // ADD LOGIC TO SAVE THE LOGGED IN USER TO REDIS, 
  // Check if the user_name is already in the list before adding it
  console.log(" ADDING user ", user_name, " to the  logged in users in Redis if it's not already there.");
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

console.log( " AFTER ADDING ", user_name, ", logged_in_users array is: ", await publisher.lrange("logged_in_users", 0, -1));

console.log(" Making a new user object for user ", user_name, " and storing it in Redis.");

    ws.user_name = user_name;
    const newUser = {
      name: user_name,
      live_question_number: "0", // initial dummy value to indicate no question yet
      live_total_score: "999", // initial dummy value to indicate no score yet
      // need to initialize these values so that JSON.GET won't return null later
      // when we try to update them 
      // see comments in live_score message handler above
    };

    console.log("********* Storing new user in Redis: ", newUser);
    await publisher.call('JSON.SET', `user:${user_name}`, '$', JSON.stringify(newUser));


    // retrieve all users from Redis using JSON.GET with a key pattern,
    //const all_users
    //
// List of keys you want to fetch

// get all logged_in_users from Redis
const loggedInUsers = await publisher.lrange("logged_in_users", 0, -1);
// loggedInUser is an array of user_names, e.g., ["teacher", "student1", "student2"]
// use this array to make keys to access ALL users (with other info such as live_question_num and live_total_score) 
// in Redis, so that we can include all logged in users' info in the welcome message when a new user connects

const keys = loggedInUsers.map(user_name => `user:${user_name}`); // create an array of keys like ["user:teacher", "user:student1", "user:student2"]
console.log("Keys to fetch all users' info from Redis: ", keys);
//const keys = ['user:teacher', 'user:student2'];

// Syntax: redis.call('JSON.MGET', key1, key2, ..., path)
try {
  const results = await publisher.call('JSON.MGET', ...keys, '$');
  console.log("Raw results (JSON) from Redis for all users: ", results);

  const users = results
    .filter((res) => res !== null)
    .map((res) => JSON.parse(res)[0]);

  console.log("Parsed user objects: ", users);

  // get live_quiz_id from Redis to include in the welcome message, so that client can update its UI accordingly if a live quiz is already in progress when the user connects
  const liveQuizId = await publisher.get("live_quiz_id");
  console.log("Current live_quiz_id in Redis: ", liveQuizId);

  //   // send a welcome message to the client when they connect
  const welcomeMessage = JSON.stringify({
    message_type: "welcome_message",
    content: `Welcome ${user_name} to the WebSocket server!`,
    user_name: user_name,
    other_connected_users: users, // include info of all other connected users in the welcome message, so that client can update its UI accordingly
    live_quiz_id: liveQuizId // include current live_quiz_id in the welcome message, so that client can update its UI accordingly if a live quiz is already in progress when the user connects
  });

  ws.send(welcomeMessage); // Send to this client only




} catch (err) {
  console.error("Error retrieving data from Redis:", err);
}
 
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
          if (message_type === "TEST") {
            try {
              // Syntax: JSON.GET <key> [path]
              const userData = await publisher.call('JSON.GET', `user:${parsedMsg.user_name}`, '$'); // '$' retrieves the entire JSON object
              if (userData) {
                console.log("Retrieved user data for user ", parsedMsg.user_name," from Redis (raw):", userData);
                const parsedUserData = JSON.parse(userData); // Parse the JSON string into a JavaScript object
                console.log("Retrieved user data from Redis:", parsedUserData);
                // broadcast test data to requesting user
                ws.send(JSON.stringify({
                  message_type: "TEST_RESPONSE",
                  content: parsedUserData,
                  user_name: parsedMsg.user_name,
                }));

              } else {
                console.log("No data found for key 'user:2'");
              }
            } catch (err) {
              console.error("Failed to retrieve user data from Redis:", err);
            }
          }
          if (message_type === "ping") {
              //console.log("Received 'ping' from client. Responding with 'pong'.");
              // you don't have to respond to pings if you don't want to, but it's a common convention to do so
              //ws.send("pong");
          }
          else if (message_type === "chat") {
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
            await publisher.del("live_question_number"); // also delete the current live_question_number for the quiz
            // delete all keys matching "*_live_question_number" for individual users
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