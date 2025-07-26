/**
 * Swap Model
 * Database model for RWA token swaps
 */

module.exports = (sequelize, DataTypes) => {
  const Swap = sequelize.define('Swap', {
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
    quote_id: {
      type: DataTypes.UUID,
      allowNull: false
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
    status: {
      type: DataTypes.ENUM('pending', 'executing', 'completed', 'failed', 'cancelled'),
      allowNull: false,
      defaultValue: 'pending'
    },
    transaction_hash: {
      type: DataTypes.STRING(64),
      allowNull: true
    },
    oracle_validation_id: {
      type: DataTypes.UUID,
      allowNull: false
    },
    liquidity_sources: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: []
    },
    routing_path: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: []
    },
    execution_steps: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: []
    },
    fees_platform: {
      type: DataTypes.DECIMAL(20, 8),
      allowNull: true,
      defaultValue: 0
    },
    fees_network: {
      type: DataTypes.DECIMAL(20, 8),
      allowNull: true,
      defaultValue: 0
    },
    fees_total: {
      type: DataTypes.DECIMAL(20, 8),
      allowNull: true,
      defaultValue: 0
    },
    execution_time_ms: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    error_message: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    started_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    completed_at: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'swaps',
    timestamps: true,
    indexes: [
      {
        fields: ['user_address']
      },
      {
        fields: ['status']
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
        fields: ['quote_id']
      },
      {
        fields: ['transaction_hash']
      }
    ],
    hooks: {
      beforeCreate: (swap) => {
        if (swap.status === 'executing' && !swap.started_at) {
          swap.started_at = new Date();
        }
      },
      beforeUpdate: (swap) => {
        if (swap.changed('status')) {
          if (swap.status === 'executing' && !swap.started_at) {
            swap.started_at = new Date();
          }
          if (['completed', 'failed', 'cancelled'].includes(swap.status) && !swap.completed_at) {
            swap.completed_at = new Date();
          }
        }
      }
    }
  });

  // Instance methods
  Swap.prototype.calculateProgress = function() {
    if (!this.execution_steps || this.execution_steps.length === 0) {
      return 0;
    }
    
    const completedSteps = this.execution_steps.filter(step => step.status === 'completed').length;
    return Math.round((completedSteps / this.execution_steps.length) * 100);
  };

  Swap.prototype.isActive = function() {
    return ['pending', 'executing'].includes(this.status);
  };

  Swap.prototype.isCompleted = function() {
    return ['completed', 'failed', 'cancelled'].includes(this.status);
  };

  // Class methods
  Swap.findByUser = function(userAddress, options = {}) {
    return this.findAll({
      where: { user_address: userAddress },
      order: [['created_at', 'DESC']],
      ...options
    });
  };

  Swap.findByStatus = function(status, options = {}) {
    return this.findAll({
      where: { status },
      order: [['created_at', 'DESC']],
      ...options
    });
  };

  Swap.getStatistics = async function() {
    const totalSwaps = await this.count();
    const completedSwaps = await this.count({ where: { status: 'completed' } });
    const totalVolume = await this.sum('output_amount', { where: { status: 'completed' } });
    const totalFees = await this.sum('fees_total', { where: { status: 'completed' } });
    
    return {
      totalSwaps,
      completedSwaps,
      totalVolume: totalVolume || 0,
      totalFees: totalFees || 0,
      successRate: totalSwaps > 0 ? (completedSwaps / totalSwaps) * 100 : 0
    };
  };

  // Associations
  Swap.associate = function(models) {
    Swap.belongsTo(models.Quote, {
      foreignKey: 'quote_id',
      as: 'quote'
    });

    Swap.belongsTo(models.User, {
      foreignKey: 'user_address',
      targetKey: 'xrpl_address',
      as: 'user'
    });

    Swap.hasMany(models.Transaction, {
      foreignKey: 'swap_id',
      as: 'transactions'
    });
  };

  return Swap;
};