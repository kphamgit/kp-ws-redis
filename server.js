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

  //console.log("Running in environment: ", process.env.NODE_ENV);

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

  // const publisher = new Redis(redisUrl, options);  // 
  // kpham: Don't try to use a "Publisher" client in Node.js unless Node.js itself needs to shout to other services. 
  // In my setup, Django is the Publisher and Node.js is the Subscriber. 
  // to GET and SET Redis data, use the regular client, which is redis defined above.
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
  
subscriber.on("message", async (channel, message) => {
  //console.log(`Received notification from Redis channel ${channel}: ${message}`);
  
  let parsedMessage;
  try {
    parsedMessage = JSON.parse(message);  // parse message as JSON string into a JavaScript object
    //console.log("Parsed notification message: ", parsedMessage);
    if( parsedMessage.message_type === "live_quiz_id") {
      // kpham: note that live_quiz_is HAD BEEN saved to Redis store by Django before publishing the live_quiz_id message to Redis channel, so we can safely retrieve it here if needed.
      //console.log("Received live_quiz_id notification from Redis. ", parsedMessage);
    }
    if (parsedMessage.message_type === "live_question_number") {
      // kpham: note that live_question_number HAD BEEN saved to Redis store by Django before publishing the live_question_number message to Redis channel, so we can safely retrieve it here if needed.
      //console.log("Received live_question_number notification from Redis. ", parsedMessage);
    }
    if (parsedMessage.message_type === "live_score") {
      // kpham: note that live_score HAD BEEN saved to Redis store by Django before publishing the live_score message to Redis channel, so we can safely retrieve it here if needed.
      //console.log("Received live_score notification from Redis. ", parsedMessage);
      // clear field live_question_number for the user in Redis,
      redis.call('JSON.SET', `user:${parsedMessage.user_name}`, '$.live_question_number', '0').then(() => {
        console.log(`live_question_number reset to 0 for user ${parsedMessage.user_name} in Redis successfully.`);
      }).catch((err) => {
        console.error(`Failed to reset live_question_number for user ${parsedMessage.user_name} in Redis: `, err);
      });

    }
    if( parsedMessage.message_type === "live_question_retrieved") {
      //console.log("Received live_question_retrieved notification from Redis. : ", parsedMessage);
      // use FT.SEARCH to find all users
      const user_name = parsedMessage.user_name;
      const live_question_number = parsedMessage.content;

      //console.log(" type of live_question_number is: ", typeof live_question_number);
      //console.log(" live_question_number is: ", live_question_number); // an integer

      // use JSON module to update live_question_number for all users in Redis, so that when a new user connects after the live question is sent out, they will get the correct live_question_number in the welcome message and update their UI accordingly
      //console.log(`Updating live_question_number to ${live_question_number} for user ${user_name} in Redis.`);
      //await redis.call('JSON.SET', `user:${user_name}`, '$.live_question_number', JSON.stringify(live_question_number));
      
      const allUsersResultsb4 = await redis.call('FT.SEARCH', 'user_idx', '*');
      const userRecordsb4 = converter(allUsersResultsb4);
      //console.log(" ALL user records BEFORE updating live_question_number for user ", user_name, "is: ", userRecordsb4);
    
      //const qNumber = 5;

// JSON.stringify(5) results in the string "5"
    await redis.call('JSON.SET', `user:${user_name}`, '$.live_question_number', live_question_number);
      //KPHAM: in the above expression, need to convert live_question_number to string first before JSON.stringify, 
      // because if live_question_number is a number, then JSON.stringify will convert it to a string with quotes (e.g., "5"), and when we retrieve it later in the client side and try to use it as a number, it will cause issues. By converting it to string first, we ensure that the value stored in Redis is a plain string without extra quotes, so that when we retrieve it later, we can use it directly as a string or convert to number as needed without worrying about extra quotes.
     
      const allUsersResults = await redis.call('FT.SEARCH', 'user_idx', '*');
      const userRecords = converter(allUsersResults);
      console.log(" ALL user records AFTER updating live_question_number for user ", user_name, "is: ", userRecords);
      
      }
    if (parsedMessage.message_type === "live_score") {
      console.log("Received live_score notification from Redis: ", parsedMessage, " question_number: ", parsedMessage.content.live_question_number);
    }
    // broadcast the message to all connected WebSocket clients, so that they can update their UIs accordingly
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message); // send the original message string to clients, since they can parse it as JSON themselves if needed
      }
    });

  } catch (e) {
    console.error("Failed to parse message as JSON: ", e);
    return; // Exit the handler if message is not valid JSON
  }

});
  

function converter(inputData) {
    const [count, ...data] = inputData;

    const results = [];
    // go through data array in chunks of 2 (key and fields array)
    for (let i = 0; i < data.length; i += 2) {
      //console.log("Processing record: ", data[i], data[i + 1]);
      const key = data[i]; // e.g., "user:teacher"
      //console.log("Key: ", key);
      const fieldsArray = data[i + 1]; // e.g., ["$", '{"name":"teacher","live_question_number":"0","live_total_score":"999"}']
      //console.log("Fields array: ", fieldsArray);
      // remove leading "$" from fields array and parse the JSON string to get the actual user data object
      const userData = JSON.parse(fieldsArray[1]);
      //console.log("Parsed user data: ", userData);
      results.push(userData);
    }
    //console.log("EXIT Converter results: ", results);
    return results;
  
}




//const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379"; // Use REDIS_URL from environment variable or default to local Redis
// Create two Redis clients: one for subscribing and one for publishing/other commands
//console.log("Connecting to Redis at: ", REDIS_URL);

// Handle WebSocket connections
wss.on("connection", async (ws, req) => {
  const wsURL = req.url;
  //console.log("Client connected via native WebSocket url=", wsURL);
  //client connected via native WebSocket url= /teacher/
  // strip leading slash and trailing slash if any
  const user_name = wsURL.replace(/^\/|\/$/g, '');

  // attach user_name to the WebSocket connection object so that it can be accessed
  // in message handlers (including close handler) without having to parse the URL again
    ws.user_name = user_name;

  //console.log("*********** User", user_name, "connected. WebSocket URL:", wsURL);
  // get all users from Redis and print out for debugging
  const all_users_before = await redis.call('FT.SEARCH', 'user_idx', '*');
  console.log("All users in Redis before adding new user: ", all_users_before);
  
  // debug
  const userRecord = await redis.call('JSON.GET', `user:${user_name}`);
  //console.log(`User record for ${user_name} before adding to Redis: `, userRecord); // should be null since the user hasn't been added to Redis yet
  // end debug
  // if userRecord exists, extract live_total_score and use it in the newUser object,
  let live_total_score = 999; // default dummy value for live_total_score if user is new and doesn't have a record in Redis yet
  let live_question_number_to_send = 0; // default dummy value for live_question_number if user is new and doesn't have a record in Redis yet
  if (userRecord) {
    const parsedUserRecord = JSON.parse(userRecord);
    live_total_score = parsedUserRecord.live_total_score;
    live_question_number_to_send = parsedUserRecord.live_question_number;
    //console.log(`User ${user_name} already exists in Redis. Using existing live_total_score: ${live_total_score} in the welcome message.`);
  }
    // if user already exists in Redis, it means they are reconnecting after a disconnection, so we should keep their existing live_total_score instead of resetting it to 999, so that they won't lose their accumulated score when they reconnect
  const newUser = {
      name: user_name,
      live_question_number: live_question_number_to_send, // initial dummy value to indicate no question yet
      live_total_score: live_total_score, // initial dummy value to indicate no score yet
      is_logged_in: "true",
      // need to initialize these values so that JSON.GET won't return null later
      // when we try to update them
      // see comments in live_score message handler above
  };

    //console.log("**************** Storing new user in Redis: ", newUser);
    await redis.call('JSON.SET', `user:${user_name}`, '$', JSON.stringify(newUser));

    const allUsersResults = await redis.call('FT.SEARCH', 'user_idx', '*');
    //console.log("RAW Search results for all users after ADDING: ", allUsersResults);

    //console.log("Search results for all users: ", allUsersResults);
    const userRecords = converter(allUsersResults);
    //console.log("Extracted user records (using indices) for welcome message: ", userRecords);

    // retrieve live_quiz_id from Redis (if any) and include it in the welcome message, so that client can update its UI accordingly if a live quiz is already in progress when the user connects
    const live_quiz_id = await redis.call('GET', 'live_quiz_id');
    const live_question_number = await redis.call('GET', 'live_question_number');
    // if live_question_number is null (e.g., no live quiz has started yet), set it to 0 in the welcome message, so that client can handle it accordingly in the UI (e.g., show "No question yet" or something like that)
    const live_question_number_for_message = live_question_number === null ? 0 : live_question_number;
    //console.log(`User ${user_name} connected. Sending welcome message with current live_quiz_id: ${live_quiz_id} and list of other connected users: `, userRecords);
    const welcomeMessage = JSON.stringify({
      message_type: "welcome_message",
      content: `Welcome ${user_name} to the WebSocket server!`,
      user_name: user_name,
      other_connected_users: userRecords, // include info of all other connected users in the welcome message, so that client can update its UI accordingly
      live_quiz_id: live_quiz_id, // include current live_quiz_id in the welcome message, so that client can update its UI accordingly if a live quiz is already in progress
      live_question_number: live_question_number_for_message, // include current live_question_number in the welcome message, 
      // so that client can update its UI accordingly if a live quiz is already in progress and a question has been sent out
    });
  
    //console.log(`Sending welcome message to user ${user_name}: `, welcomeMessage);

    ws.send(welcomeMessage); // Send to this client only

    // also notify all other connected clients about the new user, so that they can update their UIs accordingly (e.g., show the new user in the list of logged in users)
    
  
    // use wss.clients to broadcast a message to all connected clients that a new user has joined
    // except the new user themselves (since they already got a welcome message)
    //console.log(`Broadcasting to all clients that user ${user_name} has joined the session.`);
      wss.clients.forEach((client) => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
              client.send(JSON.stringify({
                message_type: "another_user_joined",
                user_name: user_name,
          }));
          }   
      });

  ws.on("message", async (msg) => {
        //console.log(`Received message from client: ${msg}`);
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
          else if (message_type === "chat") {
            // Broadcast chat message to all connected clients
            //console.log("receive ", parsedMsg.message_type, ". Broadcasting chat message to all clients.", "message content: ", parsedMsg.content);
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
          else if (message_type === "student_acknowleged_live_question_number") {
            //console.log("Received student_acknowleged_live_question_number from ", parsedMsg.user_name, " for question number ", parsedMsg.content);
            const key = parsedMsg.user_name + "_live_question_number";

          }
          //terminate_live_quiz
          else if (message_type === "terminate_live_quiz") {
            // broadcast terminate_live_quiz message to all connected clients
            // use JSON.DEL to remove live_quiz_id and live_question_number from Redis, so that when a new user connects after the quiz is terminated, they won't get outdated live_quiz_id and live_question_number in the welcome message
            await redis.call('DEL', 'live_quiz_id');
            await redis.call('DEL', 'live_question_number');
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
          else if (message_type === "TEST") {
            //console.log("Received TEST message. This is just for testing purposes.");
            const user_name = parsedMsg.user_name;

            // find all users
            if (user_name === "all") {
              const allUsersResults = await redis.call('FT.SEARCH', 'user_idx', '*');
              //console.log("RAW Search results for all users: ", allUsersResults);
              const userRecords = converter(allUsersResults);
              //console.log("All user records: ", userRecords);
              const live_quiz_id = await redis.call('GET', 'live_quiz_id');
              const live_question_number = await redis.call('GET', 'live_question_number');
              ws.send(JSON.stringify({
                message_type: "REDIS_DATA",
                content: { 
                  users: userRecords,
                  live_quiz_id: live_quiz_id,
                  live_question_number: live_question_number,
                },
                // user_name: user_name,
              }));
            }
          
            // send back the search results to the client that sent the TEST message, so that it can display the search results in the console for testing purposes
            // get live_quiz_id from Redis and include it in the message content as well, so that client can see the current live_quiz_id in the console along with the search results when they send the TEST message
       
            //console.log("Search results for all users: ", allUsersResults);
         

          }
          else if (message_type === "CLEAR_REDIS_STORE") {
              //console.log("Received CLEAR_REDIS_STORE message. Clearing all user records from Redis store for testing purposes.");
              // use FT.SEARCH to find all users except user_name "teacher"
              // const allUsersExceptTeachers = await redis.call('FT.SEARCH', 'user_idx', '* -@name:teacher');
              // The minus sign (-) acts as a "NOT" operator
                const allUsersExceptTeachers = await redis.call('FT.SEARCH', 'user_idx', '-@name:teacher');

              //const allUsersResults = await redis.call('FT.SEARCH', 'user_idx', '*');
              const userRecords = converter(allUsersExceptTeachers);
              //console.log(" ALL user records BEFORE clearing Redis store: ", userRecords);
  
              // use JSON.DEL to remove each user record from Redis
              for (const user of userRecords) {
                const user_name = user.name;
                //console.log(`**************** Removing user ${user_name} from Redis store.`);
                JSON_DEL_KEY = `user:${user_name}`;
                await redis.call('JSON.DEL', JSON_DEL_KEY);
                //console.log(`User ${user_name} removed from Redis successfully.`);
              }
              //const allUsersResultsAfterClear = await redis.call('FT.SEARCH', 'user_idx', '*');
              // const userRecordsAfterClear = converter(allUsersResultsAfterClear);
              //console.log(" ALL user records AFTER clearing Redis store: ", userRecordsAfterClear);
              // clear live_quiz_id and live_question_number from Redis as well, 
              await redis.call('DEL', 'live_quiz_id');
              await redis.call('DEL', 'live_question_number');
          }

        } catch (e) {
            console.error("Failed to parse message as JSON: ", e);
            return; // Exit the handler if message is not valid JSON
        }

    
    });

    /*

FT.CREATE user_idx ON JSON PREFIX 1 user: SCHEMA $.name AS name TEXT $.live_question_number AS live_question_number NUMERIC $.live_total_score AS live_total_score NUMERIC $.is_logged_in AS is_logged_in TAG
    */


  ws.on("close", () => {
    //console.log("WebSocket connection closed by client. url =", wsURL);
    //console.log("Client disconnected. User", ws.user_name);
    // broadcast to all connected clients that a user has left, so that they can update their UIs accordingly (e.g., remove the user from the list of logged in users)
    const userLeftMessage = JSON.stringify({
      message_type: "user_disconnected",
      user_name: ws.user_name,
    });
    //console.log(`Broadcasting to all clients that user ${ws.user_name} has left the session.`);
    
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(userLeftMessage);
      }
    });


    // note: DESIGN change (Feb 15, 2026). Now when a user is logged in, its record is not deleted from Redis when they disconnect. 
    // Instead, we will keep the user record in Redis so that use will have access to their live_question_number and live_total_score 
    // when they reconnect, 
    
        // use JSON.SET to set the is_logged_in field to "false" for the user in Redis, 
    redis.call('JSON.SET', `user:${ws.user_name}`, '$.is_logged_in', '"false"').then(() => {
      console.log(`User ${ws.user_name} marked as logged out in Redis successfully.`);
    }).catch((err) => {
      console.error(`Failed to mark user ${ws.user_name} as logged out in Redis: `, err);
    });

    /*
    // use JSON.DEL to remove the user record from Redis when a user disconnects, so that the list of logged in users is always up to date
    //console.log(`**************** Removing user ${ws.user_name} from Redis store.`);
    JSON_DEL_KEY = `user:${ws.user_name}`;
    redis.call('JSON.DEL', JSON_DEL_KEY).then(() => {
      console.log(`User ${ws.user_name} removed from Redis successfully.`);
    }).catch((err) => {
      console.error(`Failed to remove user ${ws.user_name} from Redis: `, err);
    });
    */
    // note: user_name is attached to the WebSocket connection object in the connection handler, 
    // so we can access it here without having to parse the URL again
    // remove user_name from the list of logged in users in Redis
 
  });
  
});

console.log("WebSocket server is up and running on port " + PORT);