/* jshint node: true, devel: true */
'use strict';

const bodyParser = require('body-parser');
const config = require('config');
const crypto = require('crypto');
const express = require('express');
const https = require('https');
const request = require('request');
const oauth2 = require('simple-oauth2');

var app = express();
app.set('port', process.env.PORT || 5000);
app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');
app.use(bodyParser.json());
app.use(express.static(__dirname + '/public'));

// Get config values
const SERVER_URL = config.get('SERVER_URL');
const API42_HOST = config.get('API42_HOST');
const API42_UID = config.get('API42_UID');
const API42_SECRET = process.env.API42_SECRET;

if (!(SERVER_URL && API42_HOST && API42_UID && API42_SECRET)) {
  console.error("Missing config values");
  process.exit(1);
}

// Get 42 OAuth set up
const auth42 = oauth2.create({
  client: {
    id: API42_UID,
    secret: API42_SECRET
  },
  auth: {
    tokenHost: API42_HOST,
    tokenPath: '/oauth/token',
    authorizePath: '/oauth/authorize'
  }
});

const auth42URI = auth42.authorizationCode.authorizeURL({
  redirect_uri: SERVER_URL+'/auth42',
  scope: 'public projects',
  state: ''
});

// app.get('/', function(req, res) {
//   res.render('authorize', {
//     redirectURI: SERVER_URL+'/redirect42'
//   });
// });

app.get('/', (req, res) => {
  res.send('Slot Checker 42<br><a href="/auth42_redirect">Log in with intra42</a>');
});

app.get('/auth42_redirect', function(req, res) {
  res.redirect(auth42URI);
});

app.get('/auth42', function(req, res) {
  console.log('Callback Query:', req.query);
  const code = req.query.code;
  const options = {
    code: code,
    redirect_uri: SERVER_URL+'/auth42'
  };

  auth42.authorizationCode.getToken(options, (error, result) => {
    if (error) {
      console.error('Access Token Error', error.message);
      return res.json('Authentication failed');
    }

    console.log('The resulting token: ', result);
    const token = auth42.accessToken.create(result);

    return res
      .status(200)
      .json(token);
  });
});



// Start server
// Webhooks must be available via SSL with a certificate signed by a valid 
// certificate authority.
app.listen(app.get('port'), function() {
  console.log('Node app is running on port', app.get('port'));
});

module.exports = app;
