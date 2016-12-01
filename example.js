/* jshint node: true, devel: true */
'use strict';

const 
  bodyParser = require('body-parser'),
  config = require('config'),
  crypto = require('crypto'),
  express = require('express'),
  https = require('https'),  
  request = require('request');
  // request = require('request-promise');

var app = express();
app.set('port', process.env.PORT || 5000);
app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');
app.use(bodyParser.json({ verify: verifyRequestSignature }));
app.use(express.static(__dirname + '/public'));

/*
 * Be sure to setup your config values before running this code. You can 
 * set them using environment variables or modifying the config file in /config.
 *
 */

// URL where the app is running (include protocol). Used to point to scripts and 
// assets located at this address. 
const SERVER_URL = config.get('serverURL');

if (!(SERVER_URL)) {
  console.error("Missing config values");
  process.exit(1);
}

const WIT_TOKEN = config.get('witToken');

if (!WIT_TOKEN) {
  console.error("Missing Wit token");
  process.exit(1);
}

app.get('/webhook', function(req, res) {
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === VALIDATION_TOKEN) {
    console.log("Validating webhook");
    res.status(200).send(req.query['hub.challenge']);
  } else {
    console.error("Failed validation. Make sure the validation tokens match.");
    res.sendStatus(403);          
  }  
});

app.post('/webhook', function (req, res) {
  var data = req.body;
  console.log('Call body:', data);
  res.sendStatus(200);
});

/* v==================================== WIT ====================================v */

const fbSessions = {};

function firstEntityValue(entities, entity) {
  var val = entities && entities[entity] && Array.isArray(entities[entity]) && entities[entity].length > 0 && entities[entity][0].value;
  if (!val) {
    return null;
  }
  return typeof val === 'object' ? val.value : val;
};

function getWeather(location, callback) {
  request({
    uri: 'http://api.openweathermap.org/data/2.5/find',
    qs: { q: location, type: 'like', appid: 'e5bbcdf6706674bb9cba4e3e82cf57f8' },
    method: 'GET'
  }, callback);
}

const actions = {
  send: function(request, response) {
    const sessionId = request.sessionId;
    const text = response.text;
    // Our bot has something to say!
    // Let's retrieve the Facebook user whose session belongs to
    const recipientId = fbSessions[sessionId].fbid;
    if (recipientId) {
      // Yay, we found our recipient!
      // Let's forward our bot response to her.
      // We return a promise to let our bot know when we're done sending
      return sendTextMessage(recipientId, text);
      // .then(() => null)
      // .catch((err) => {
      //   console.error('Oops! An error occurred while forwarding the response to', recipientId, ':', err.stack || err);
      // });
    } else {
      console.error('Oops! Couldn\'t find user for session:', sessionId);
      // Giving the wheel back to our bot
      return Promise.resolve();
    }
  },
  getForecast: function(request) {
    return new Promise(function(resolve, reject) {
      var location = firstEntityValue(request.entities, "location");
      if (location) {
        getWeather(location, function (error, response, body) {
          if (!error && response.statusCode == 200) {
            const json_body = JSON.parse(body);
            console.log('OpenWeatherMap API Request Response Body:', json_body);
            if (json_body && json_body.list && json_body.list[0] && json_body.list[0].weather && json_body.list[0].weather[0] && json_body.list[0].weather[0].description) {
              var weather = json_body.list[0].weather[0].description.toLowerCase();
              console.log('OpenWeatherMap API Request Response Weather:', weather.toString());
              if (weather.toString() === 'sky is clear') { weather = 'clear skies'; }
              request.context.forecast = weather + ' in ' + json_body.list[0].name;
            } else {
              request.context.forecast = 'a surprise in ' + location;
            }
            delete request.context.missingLocation;
            resolve(request.context);
          } else {
            console.error("Failed calling User Profile API", response.statusCode, response.statusMessage, body.error);
          }
        });
      } else {
        request.context.missingLocation = true;
        delete request.context.forecast;
        return resolve(request.context);
      }
    });
  }
};

// Setting up our bot
const wit = new Wit({
  accessToken: WIT_TOKEN,
  actions,
  logger: new log.Logger(log.DEBUG)
});

function findSession(fbid) {
  let sessionId;
  // Let's see if we already have a session for the user fbid
  Object.keys(fbSessions).forEach(k => {
    if (fbSessions[k].fbid === fbid) {
      // Yep, got it!
      sessionId = k;
    }
  });
  return sessionId;
};

function findOrCreateSession(fbid) {
  let sessionId;
  // Let's see if we already have a session for the user fbid
  sessionId = findSession(fbid);
  if (!sessionId) {
    // No session found for user fbid, let's create a new one
    sessionId = new Date().toISOString();
    fbSessions[sessionId] = {fbid: fbid, context: {}};
  }
  return sessionId;
};

function fbMessage(fbid, text) {
  const sessionId = findOrCreateSession(fbid);
  wit.runActions(
    sessionId, // the user's current session
    text, // the user's message
    fbSessions[sessionId].context // the user's current session state
  ).then((context) => {
    // Our bot did everything it has to do.
    // Now it's waiting for further messages to proceed.
    console.log('Waiting for next user messages');

    // Based on the session state, you might want to reset the session.
    // This depends heavily on the business logic of your bot.
    if (context['done']) {
      delete fbSessions[sessionId];
    }

    // Updating the user's current session state
    fbSessions[sessionId].context = context;
  })
  .catch((err) => {
    console.error('Oops! Got an error from Wit: ', err.stack || err);
  });
};

/* ^==================================== WIT ====================================^ */

function receivedMessage(event) {
  var senderID = event.sender.id;
  var recipientID = event.recipient.id;
  var timeOfMessage = event.timestamp;
  var message = event.message;

  console.log("Received message for user %d and page %d at %d with message:", senderID, recipientID, timeOfMessage);
  console.log(JSON.stringify(message));

  var isEcho = message.is_echo;
  var messageId = message.mid;
  var appId = message.app_id;
  var metadata = message.metadata;

  // You may get a text or attachment but not both
  var messageText = message.text;
  var messageAttachments = message.attachments;
  var quickReply = message.quick_reply;

  if (isEcho) {
    console.log("Received echo for message %s and app %d with metadata %s", messageId, appId, metadata);
    return;
  }
  else if (quickReply) {
    var quickReplyPayload = quickReply.payload;
    console.log("Quick reply for message %s with payload %s", messageId, quickReplyPayload);

    // sendTextMessage(senderID, "Quick reply tapped");
    return;
  }

  if (findSession(senderID) == null) {
    const sessionID = findOrCreateSession(senderID);
    request({
      uri: 'https://graph.facebook.com/v2.6/'+senderID,
      qs: { fields: 'first_name,last_name,profile_pic,locale,timezone,gender', access_token: PAGE_ACCESS_TOKEN },
      method: 'GET'
    }, function (error, response, body) {
      if (!error && response.statusCode == 200) {
        const json_body = JSON.parse(body);
        fbSessions[sessionID].profile = json_body;
        console.log('User Profile API Request Response Body:', json_body);
        sendTextMessage(senderID, 'Bonjour ' + json_body.first_name + ' ' + json_body.last_name);
        sendTextMessage(senderID, 'Je suis un bot créé par sploadie');
        return;
      } else {
        console.error("Failed calling User Profile API", response.statusCode, response.statusMessage, body.error);
      }
    });
    return;
  }

  if (messageText) {
    fbMessage(senderID, messageText);
  } else if (messageAttachments) {
    sendTextMessage(senderID, "That, is a very nice attachment. ^^");
  }
}

function sendTextMessage(recipientId, messageText) {
  var messageData = {
    recipient: {
      id: recipientId
    },
    message: {
      text: messageText,
      metadata: "DEVELOPER_DEFINED_METADATA"
    }
  };

  callSendAPI(messageData);
}

function callSendAPI(messageData) {
  request({
    uri: 'https://graph.facebook.com/v2.6/me/messages',
    qs: { access_token: PAGE_ACCESS_TOKEN },
    method: 'POST',
    json: messageData

  }, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      console.log('Send API Request Response Body:', body);
      var recipientId = body.recipient_id;
      var messageId = body.message_id;

      if (messageId) {
        console.log("Successfully sent message with id %s to recipient %s", 
          messageId, recipientId);
      } else {
      console.log("Successfully called Send API for recipient %s", 
        recipientId);
      }
    } else {
      console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
    }
  });
}

// Start server
// Webhooks must be available via SSL with a certificate signed by a valid 
// certificate authority.
app.listen(app.get('port'), function() {
  console.log('Node app is running on port', app.get('port'));
});

module.exports = app;
