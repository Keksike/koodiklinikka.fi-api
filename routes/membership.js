'use strict';

var Promise           = require('bluebird');
var GoogleSpreadsheet = require('google-spreadsheet');
var async             = require('async');
var moment            = require('moment');
var Joi               = require('joi');

var config          = require('../lib/config');
var slack           = require('../services/slack');
var stripe          = require('stripe')(config.stripe.secretKey);
var validateRequest = require('../utils/validateRequest');

function log(message) {
  console.log(message);
  slack.createMessage(message);
}

function addNewMemberToSheets(data, callback) {
  var {name, email, address, postcode, city, handle} = data;
  var doc = new GoogleSpreadsheet(config.google.spreadsheetId);

  async.waterfall([
    function setAuth(cb) {
      console.log('Start Google Spreadsheed auth.');
      doc.useServiceAccountAuth({
        client_email: config.google.clientEmail,
        private_key: config.google.privateKey
      }, (err) => cb(err));
    },
    function getInfoAndWorksheets(cb) {
      console.log('Start Google Spreadsheet info fetch.');
      doc.getInfo(function(err, info) {
        if(err) {
          cb(err);
        } else {
          cb(null, info.worksheets[0]);
        }
      });
    },
    function addRow(sheet, cb) {
      console.log('Start Google Spreadsheet row write.');
      sheet.addRow({
        'jäsenmaksu':     moment().format('DD.MM.YYYY'),
        'katuosoite':     address,
        'koko nimi':      name,
        'liittymispäivä': moment().format('DD.MM.YYYY'),
        'lisääjä':        'koodiklinikka.fi-api',
        'paikkakunta':    city,
        'postinumero':    postcode,
        'slack':          handle,
        'sähköposti':     email
      }, cb);
    }
  ], callback);
}

module.exports = function (app) {
  /*
   * POST /membership
   * Endpoint for adding a new member to the association
   */

  const schema = Joi.object().keys({
    userInfo: Joi.object().keys({
      address:  Joi.string().required(),
      city:     Joi.string().required(),
      email:    Joi.string().email().required(),
      handle:   Joi.string().required(),
      name:     Joi.string().required(),
      postcode: Joi.string().required()
    }),
    stripeToken: Joi.string().required()
  })

  app.post('/membership', validateRequest(schema), function(req, res, next) {

    console.log(`Start membership addition with body: ${JSON.stringify(req.body)}`);

    const { handle, name, email } = req.body.userInfo

    const createCustomer = (callback) =>
      stripe.customers.create({
        description: `${handle} - ${name}`,
        email:        email,
        metadata:     req.body.userInfo,
        source:       req.body.stripeToken
      }, callback)

    const createSubscription = (customer, callback) =>
      stripe.subscriptions.create({
        customer: customer.id,
        plan:     'koodiklinikka'
      }, callback)

    async.waterfall([
      createCustomer,
      createSubscription
    ], (err) => {
      if (err) {
        log(`Membership payment FAILED for: ${JSON.stringify(req.body.userInfo.email)}. Reason: ${err.message}`);
        res.status(500).send('payment_error');
        return;
      }

      log(`Membership payment SUCCESSFUL for: ${JSON.stringify(req.body.userInfo.email)}`);
      addNewMemberToSheets(req.body.userInfo, (err) => {
        if(err) {
          log(`Storing membership info FAILED for: ${JSON.stringify(req.body.userInfo.email)}. Reason: ${err.message}`);
          res.status(500).send('membership_storage_error');
          return;
        }
        res.status(200).send('payment_success');
      });
    });
  });
};
