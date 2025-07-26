/**
 * Quote Model
 * Database model for swap quotes
 */

module.exports = (sequelize, DataTypes) => {
  const Quote = sequelize.define('Quote', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    user_address: {
      type: DataTypes.STRING(34),
      allowNull: false,
      validate: {
        len: [25, 34]
      }
    },
    rwa_token_currency: {
      type: DataTypes.STRING(15),
      allowNull: false
    },
    rwa_token_issuer: {
      type: DataTypes.STRING(34),
      allowNull: false
    },
    rwa_token_amount: {
      type: DataTypes.DECIMAL(20, 8),
      allowNull: false,
      validate: {
        min: 0
      }
    },
    target_currency: {
      type: DataTypes.STRING(10),
      allowNull: false,
      validate: {
        isIn: [['XRP', 'USDT', 'USDC', 'USD']]
      }
    },
    input_amount: {
      type: DataTypes.DECIMAL(20, 8),
      allowNull: false,
      validate: {
        min: 0
      }
    },
    output_amount: {
      type: DataTypes.DECIMAL(20, 8),
      allowNull: false,
      validate: {
        min: 0
      }
    },
    discount_rate: {
      type: DataTypes.DECIMAL(4, 3),
      allowNull: false,
      validate: {
        min: 0.1,
        max: 1.0
      }
    },
    swap_rate: {
      type: DataTypes.DECIMAL(20, 8),
      allowNull: false
    },
    slippage: {
      type: DataTypes.DECIMAL(6, 5),
      allowNull: false,
      defaultValue: 0.0
    },
    oracle_validation_id: {
      type: DataTypes.UUID,
      allowNull: false
    },
    liquidity_sources: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: []
    },
    routing_path: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: []
    },
    fees_breakdown: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {}
    },
    fees_total: {
      type: DataTypes.DECIMAL(20, 8),
      allowNull: false,
      defaultValue: 0
    },
    valid_until: {
      type: DataTypes.DATE,
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('active', 'executed', 'expired', 'cancelled'),
      allowNull: false,
      defaultValue: 'active'
    },
    execution_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    market_conditions: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {}
    }
  }, {
    tableName: 'quotes',
    timestamps: true,
    indexes: [
      {
        fields: ['user_address']
      },
      {
        fields: ['status']
      },
      {
        fields: ['valid_until']
      },
      {
        fields: ['rwa_token_currency']
      },
      {
        fields: ['target_currency']
      },
      {
        fields: ['created_at']
      },
      {
        fields: ['oracle_validation_id']
      }
    ],
    hooks: {
      beforeCreate: (quote) => {
        // Set valid_until if not provided (default 30 seconds from now)
        if (!quote.valid_until) {
          quote.valid_until = new Date(Date.now() + 30000);
        }
      }
    }
  });

  // Instance methods
  Quote.prototype.isValid = function() {
    return this.status === 'active' && new Date() < this.valid_until;
  };

  Quote.prototype.isExpired = function() {
    return new Date() >= this.valid_until;
  };

  Quote.prototype.getRemainingTime = function() {
    const now = new Date();
    const remaining = this.valid_until.getTime() - now.getTime();
    return Math.max(0, remaining);
  };

  Quote.prototype.getRemainingTimeSeconds = function() {
    return Math.floor(this.getRemainingTime() / 1000);
  };

  Quote.prototype.markAsExecuted = function() {
    this.status = 'executed';
    this.execution_count += 1;
    return this.save();
  };

  Quote.prototype.markAsExpired = function() {
    this.status = 'expired';
    return this.save();
  };

  Quote.prototype.getEffectiveRate = function() {
    return this.output_amount / this.input_amount;
  };

  Quote.prototype.getFeePercentage = function() {
    return (this.fees_total / this.input_amount) * 100;
  };

  // Class methods
  Quote.findActiveByUser = function(userAddress, options = {}) {
    return this.findAll({
      where: { 
        user_address: userAddress,
        status: 'active',
        valid_until: {
          [sequelize.Sequelize.Op.gt]: new Date()
        }
      },
      order: [['created_at', 'DESC']],
      ...options
    });
  };

  Quote.findValidQuote = function(quoteId) {
    return this.findOne({
      where: {
        id: quoteId,
        status: 'active',
        valid_until: {
          [sequelize.Sequelize.Op.gt]: new Date()
        }
      }
    });
  };

  Quote.expireOldQuotes = async function() {
    const expiredCount = await this.update(
      { status: 'expired' },
      {
        where: {
          status: 'active',
          valid_until: {
            [sequelize.Sequelize.Op.lte]: new Date()
          }
        }
      }
    );
    
    return expiredCount[0]; // Number of affected rows
  };

  Quote.getStatistics = async function() {
    const totalQuotes = await this.count();
    const activeQuotes = await this.count({ where: { status: 'active' } });
    const executedQuotes = await this.count({ where: { status: 'executed' } });
    const expiredQuotes = await this.count({ where: { status: 'expired' } });
    
    const avgOutputAmount = await this.aggregate('output_amount', 'AVG', {
      where: { status: 'executed' }
    });
    
    const avgFees = await this.aggregate('fees_total', 'AVG', {
      where: { status: 'executed' }
    });

    return {
      totalQuotes,
      activeQuotes,
      executedQuotes,
      expiredQuotes,
      executionRate: totalQuotes > 0 ? (executedQuotes / totalQuotes) * 100 : 0,
      avgOutputAmount: avgOutputAmount || 0,
      avgFees: avgFees || 0
    };
  };

  Quote.findByRWACategory = function(category, options = {}) {
    const categoryPrefixes = {
      'REAL_ESTATE': 'rPROP',
      'PRECIOUS_METALS': 'rMETL',
      'VEHICLES': 'rVEHI',
      'COLLECTIBLES': 'rCOLL',
      'EQUIPMENT': 'rEQIP'
    };

    const prefix = categoryPrefixes[category];
    if (!prefix) {
      return Promise.resolve([]);
    }

    return this.findAll({
      where: {
        rwa_token_currency: {
          [sequelize.Sequelize.Op.like]: `${prefix}%`
        }
      },
      order: [['created_at', 'DESC']],
      ...options
    });
  };

  // Associations
  Quote.associate = function(models) {
    Quote.belongsTo(models.User, {
      foreignKey: 'user_address',
      targetKey: 'xrpl_address',
      as: 'user'
    });

    Quote.hasMany(models.Swap, {
      foreignKey: 'quote_id',
      as: 'swaps'
    });
  };

  return Quote;
};