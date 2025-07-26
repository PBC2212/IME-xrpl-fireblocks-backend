/**
 * User Model
 * Database model for platform users
 */

const bcrypt = require('bcryptjs');

module.exports = (sequelize, DataTypes) => {
  const User = sequelize.define('User', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    xrpl_address: {
      type: DataTypes.STRING(34),
      allowNull: false,
      unique: true,
      validate: {
        len: [25, 34]
      }
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: true,
      unique: true,
      validate: {
        isEmail: true
      }
    },
    username: {
      type: DataTypes.STRING(50),
      allowNull: true,
      unique: true,
      validate: {
        len: [3, 50],
        isAlphanumeric: true
      }
    },
    password_hash: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    first_name: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    last_name: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    country: {
      type: DataTypes.STRING(2),
      allowNull: true,
      validate: {
        len: [2, 2]
      }
    },
    tier_level: {
      type: DataTypes.ENUM('retail', 'institutional', 'enterprise'),
      allowNull: false,
      defaultValue: 'retail'
    },
    kyc_status: {
      type: DataTypes.ENUM('none', 'basic', 'advanced', 'verified', 'rejected'),
      allowNull: false,
      defaultValue: 'none'
    },
    kyc_verified_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    is_active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    is_email_verified: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    email_verified_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    last_login_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    login_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    preferences: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {
        notifications: {
          email: true,
          swap_updates: true,
          marketing: false
        },
        trading: {
          default_slippage: 0.05,
          auto_execute: false
        }
      }
    },
    trading_limits: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {
        daily_limit: 50000,
        monthly_limit: 500000,
        per_swap_limit: 100000
      }
    },
    api_key: {
      type: DataTypes.STRING(64),
      allowNull: true,
      unique: true
    },
    api_secret_hash: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    two_factor_enabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    two_factor_secret: {
      type: DataTypes.STRING(32),
      allowNull: true
    },
    backup_codes: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: []
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {}
    }
  }, {
    tableName: 'users',
    timestamps: true,
    indexes: [
      {
        fields: ['xrpl_address'],
        unique: true
      },
      {
        fields: ['email'],
        unique: true
      },
      {
        fields: ['username'],
        unique: true
      },
      {
        fields: ['tier_level']
      },
      {
        fields: ['kyc_status']
      },
      {
        fields: ['is_active']
      },
      {
        fields: ['api_key'],
        unique: true
      }
    ],
    hooks: {
      beforeCreate: async (user) => {
        if (user.password_hash) {
          user.password_hash = await bcrypt.hash(user.password_hash, 12);
        }
        if (user.api_secret_hash) {
          user.api_secret_hash = await bcrypt.hash(user.api_secret_hash, 12);
        }
      },
      beforeUpdate: async (user) => {
        if (user.changed('password_hash') && user.password_hash) {
          user.password_hash = await bcrypt.hash(user.password_hash, 12);
        }
        if (user.changed('api_secret_hash') && user.api_secret_hash) {
          user.api_secret_hash = await bcrypt.hash(user.api_secret_hash, 12);
        }
      }
    }
  });

  // Instance methods
  User.prototype.validatePassword = async function(password) {
    if (!this.password_hash) return false;
    return bcrypt.compare(password, this.password_hash);
  };

  User.prototype.validateApiSecret = async function(secret) {
    if (!this.api_secret_hash) return false;
    return bcrypt.compare(secret, this.api_secret_hash);
  };

  User.prototype.getFullName = function() {
    if (this.first_name && this.last_name) {
      return `${this.first_name} ${this.last_name}`;
    }
    return this.username || this.email || this.xrpl_address;
  };

  User.prototype.updateLastLogin = function() {
    this.last_login_at = new Date();
    this.login_count += 1;
    return this.save();
  };

  User.prototype.canTrade = function(amount) {
    if (!this.is_active) return false;
    if (this.kyc_status === 'rejected') return false;
    
    const limits = this.trading_limits || {};
    return amount <= (limits.per_swap_limit || 100000);
  };

  User.prototype.isKYCVerified = function() {
    return ['advanced', 'verified'].includes(this.kyc_status);
  };

  User.prototype.getTierBenefits = function() {
    const benefits = {
      retail: {
        max_swap_amount: 50000,
        fee_discount: 0,
        priority_support: false,
        advanced_features: false
      },
      institutional: {
        max_swap_amount: 500000,
        fee_discount: 0.2, // 20% discount
        priority_support: true,
        advanced_features: true
      },
      enterprise: {
        max_swap_amount: 10000000,
        fee_discount: 0.4, // 40% discount
        priority_support: true,
        advanced_features: true,
        dedicated_manager: true
      }
    };

    return benefits[this.tier_level] || benefits.retail;
  };

  User.prototype.generateApiCredentials = function() {
    const apiKey = require('crypto').randomBytes(32).toString('hex');
    const apiSecret = require('crypto').randomBytes(32).toString('hex');
    
    this.api_key = apiKey;
    this.api_secret_hash = apiSecret; // Will be hashed by beforeUpdate hook
    
    return { apiKey, apiSecret };
  };

  User.prototype.revokeApiCredentials = function() {
    this.api_key = null;
    this.api_secret_hash = null;
    return this.save();
  };

  // Class methods
  User.findByXRPLAddress = function(xrplAddress) {
    return this.findOne({
      where: { xrpl_address: xrplAddress }
    });
  };

  User.findByEmail = function(email) {
    return this.findOne({
      where: { email: email.toLowerCase() }
    });
  };

  User.findByUsername = function(username) {
    return this.findOne({
      where: { username: username.toLowerCase() }
    });
  };

  User.findByApiKey = function(apiKey) {
    return this.findOne({
      where: { 
        api_key: apiKey,
        is_active: true
      }
    });
  };

  User.findActiveUsers = function(options = {}) {
    return this.findAll({
      where: { is_active: true },
      order: [['created_at', 'DESC']],
      ...options
    });
  };

  User.findByTier = function(tierLevel, options = {}) {
    return this.findAll({
      where: { tier_level: tierLevel },
      order: [['created_at', 'DESC']],
      ...options
    });
  };

  User.findByKYCStatus = function(kycStatus, options = {}) {
    return this.findAll({
      where: { kyc_status: kycStatus },
      order: [['created_at', 'DESC']],
      ...options
    });
  };

  User.getStatistics = async function() {
    const totalUsers = await this.count();
    const activeUsers = await this.count({ where: { is_active: true } });
    const verifiedUsers = await this.count({ 
      where: { kyc_status: ['advanced', 'verified'] }
    });
    
    const tierBreakdown = await this.findAll({
      attributes: [
        'tier_level',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: ['tier_level'],
      raw: true
    });

    const kycBreakdown = await this.findAll({
      attributes: [
        'kyc_status',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: ['kyc_status'],
      raw: true
    });

    return {
      totalUsers,
      activeUsers,
      verifiedUsers,
      verificationRate: totalUsers > 0 ? (verifiedUsers / totalUsers) * 100 : 0,
      tierBreakdown: tierBreakdown.reduce((acc, tier) => {
        acc[tier.tier_level] = parseInt(tier.count);
        return acc;
      }, {}),
      kycBreakdown: kycBreakdown.reduce((acc, kyc) => {
        acc[kyc.kyc_status] = parseInt(kyc.count);
        return acc;
      }, {})
    };
  };

  // Associations
  User.associate = function(models) {
    User.hasMany(models.Swap, {
      foreignKey: 'user_address',
      sourceKey: 'xrpl_address',
      as: 'swaps'
    });

    User.hasMany(models.Quote, {
      foreignKey: 'user_address',
      sourceKey: 'xrpl_address',
      as: 'quotes'
    });

    User.hasMany(models.RWAToken, {
      foreignKey: 'owner_address',
      sourceKey: 'xrpl_address',
      as: 'rwa_tokens'
    });
  };

  return User;
};