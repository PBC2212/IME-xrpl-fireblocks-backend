/**
 * Database Models Index
 * Initializes and exports all database models
 */

const { sequelize } = require('../config/database');
const { DataTypes } = require('sequelize');

// Import all models
const Swap = require('./Swap');
const Quote = require('./Quote');
const User = require('./User');
const RWAToken = require('./RWAToken');
const Transaction = require('./Transaction');

// Initialize models with sequelize instance
const models = {
  Swap: Swap(sequelize, DataTypes),
  Quote: Quote(sequelize, DataTypes),
  User: User(sequelize, DataTypes),
  RWAToken: RWAToken(sequelize, DataTypes),
  Transaction: Transaction(sequelize, DataTypes)
};

// Define associations
Object.keys(models).forEach(modelName => {
  if (models[modelName].associate) {
    models[modelName].associate(models);
  }
});

// Add sequelize instance and constructor to models
models.sequelize = sequelize;
models.Sequelize = require('sequelize');

module.exports = models;