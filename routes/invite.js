'use strict';

var validator = require('validator');
var config = require('../lib/config');
var request = require('superagent');


module.exports = function (app) {
  /*
   * POST /invites
   * Endpoint for sending invitations automatically
   */

  app.post('/invites', function(req, res, next) {

    if(!validator.isEmail(req.body.email)) {
      res.status(400).send('Invalid email');
    }

    request
    .post('https://koodiklinikka.slack.com/api/chat.postMessage')
    .field('text', 'Invitation request for: ' + req.body.email)
    .field('channel', config.slack.channels)
    .field('token', config.slack.token)
    .end(function(error, response){
      if(error) {
        return next(error);
      }

      if(!response.body.ok) {
        console.error(response.body.error);
        var err = new Error('Creating slack invitation failed:');
        return next(err);
      }

      res.status(200).end();
    });

  });

};
