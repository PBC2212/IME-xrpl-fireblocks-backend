/**
 * Transaction Model
 * Database model for XRPL and platform transactions
 */

module.exports = (sequelize, DataTypes) => {
  const Transaction = sequelize.define('Transaction', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    transaction_hash: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true
    },
    transaction_type: {
      type: DataTypes.ENUM(
        'token_issuance',
        'token_transfer', 
        'swap_execution',
        'fee_payment',
        'liquidity_provision',
        'escrow_create',
        'escrow_finish',
        'trust_line',
        'offer_create',
        'offer_cancel',
        'payment'
      ),
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('pending', 'submitted', 'validated', 'failed', 'cancelled'),
      allowNull: false,
      defaultValue: 'pending'
    },
    network: {
      type: DataTypes.ENUM('xrpl_mainnet', 'xrpl_testnet', 'ethereum', 'polygon'),
      allowNull: false,
      defaultValue: 'xrpl_testnet'
    },
    ledger_index: {
      type: DataTypes.BIGINT,
      allowNull: true
    },
    sequence_number: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    from_address: {
      type: DataTypes.STRING(34),
      allowNull: false,
      validate: {
        len: [25, 34]
      }
    },
    to_address: {
      type: DataTypes.STRING(34),
      allowNull: true,
      validate: {
        len: [25, 34]
      }
    },
    amount: {
      type: DataTypes.DECIMAL(20, 8),
      allowNull: true,
      validate: {
        min: 0
      }
    },
    currency: {
      type: DataTypes.STRING(15),
      allowNull: true
    },
    issuer: {
      type: DataTypes.STRING(34),
      allowNull: true
    },
    fee: {
      type: DataTypes.DECIMAL(20, 8),
      allowNull: true,
      defaultValue: 0,
      validate: {
        min: 0
      }
    },
    network_fee: {
      type: DataTypes.DECIMAL(20, 8),
      allowNull: true,
      defaultValue: 0
    },
    gas_used: {
      type: DataTypes.BIGINT,
      allowNull: true
    },
    gas_price: {
      type: DataTypes.DECIMAL(20, 8),
      allowNull: true
    },
    swap_id: {
      type: DataTypes.UUID,
      allowNull: true
    },
    rwa_token_id: {
      type: DataTypes.UUID,
      allowNull: true
    },
    user_id: {
      type: DataTypes.UUID,
      allowNull: true
    },
    raw_transaction: {
      type: DataTypes.JSON,
      allowNull: true
    },
    transaction_result: {
      type: DataTypes.JSON,
      allowNull: true
    },
    meta_data: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {}
    },
    error_code: {
      type: DataTypes.STRING(20),
      allowNull: true
    },
    error_message: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    confirmation_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    required_confirmations: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1
    },
    submitted_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    validated_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    block_timestamp: {
      type: DataTypes.DATE,
      allowNull: true
    },
    retry_count: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    max_retries: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 3
    },
    tags: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: []
    }
  }, {
    tableName: 'transactions',
    timestamps: true,
    indexes: [
      {
        fields: ['transaction_hash'],
        unique: true
      },
      {
        fields: ['status']
      },
      {
        fields: ['transaction_type']
      },
      {
        fields: ['network']
      },
      {
        fields: ['from_address']
      },
      {
        fields: ['to_address']
      },
      {
        fields: ['swap_id']
      },
      {
        fields: ['rwa_token_id']
      },
      {
        fields: ['user_id']
      },
      {
        fields: ['ledger_index']
      },
      {
        fields: ['submitted_at']
      },
      {
        fields: ['validated_at']
      }
    ],
    hooks: {
      beforeUpdate: (transaction) => {
        if (transaction.changed('status')) {
          if (transaction.status === 'submitted' && !transaction.submitted_at) {
            transaction.submitted_at = new Date();
          }
          if (transaction.status === 'validated' && !transaction.validated_at) {
            transaction.validated_at = new Date();
          }
        }
      }
    }
  });

  // Instance methods
  Transaction.prototype.isConfirmed = function() {
    return this.confirmation_count >= this.required_confirmations;
  };

  Transaction.prototype.isPending = function() {
    return ['pending', 'submitted'].includes(this.status);
  };

  Transaction.prototype.isCompleted = function() {
    return this.status === 'validated';
  };

  Transaction.prototype.isFailed = function() {
    return ['failed', 'cancelled'].includes(this.status);
  };

  Transaction.prototype.canRetry = function() {
    return this.isFailed() && this.retry_count < this.max_retries;
  };

  Transaction.prototype.incrementConfirmation = function() {
    this.confirmation_count += 1;
    if (this.isConfirmed() && this.status === 'submitted') {
      this.status = 'validated';
      this.validated_at = new Date();
    }
    return this.save();
  };

  Transaction.prototype.markAsSubmitted = function(txHash) {
    if (txHash) {
      this.transaction_hash = txHash;
    }
    this.status = 'submitted';
    this.submitted_at = new Date();
    return this.save();
  };

  Transaction.prototype.markAsValidated = function(ledgerIndex, blockTimestamp) {
    this.status = 'validated';
    this.validated_at = new Date();
    if (ledgerIndex) {
      this.ledger_index = ledgerIndex;
    }
    if (blockTimestamp) {
      this.block_timestamp = blockTimestamp;
    }
    return this.save();
  };

  Transaction.prototype.markAsFailed = function(errorCode, errorMessage) {
    this.status = 'failed';
    this.error_code = errorCode;
    this.error_message = errorMessage;
    return this.save();
  };

  Transaction.prototype.incrementRetry = function() {
    this.retry_count += 1;
    this.status = 'pending';
    return this.save();
  };

  Transaction.prototype.getExecutionTime = function() {
    if (!this.submitted_at) return null;
    const endTime = this.validated_at || new Date();
    return endTime.getTime() - this.submitted_at.getTime();
  };

  Transaction.prototype.addTag = function(tag) {
    if (!this.tags.includes(tag)) {
      this.tags.push(tag);
      return this.save();
    }
    return Promise.resolve(this);
  };

  Transaction.prototype.removeTag = function(tag) {
    const index = this.tags.indexOf(tag);
    if (index > -1) {
      this.tags.splice(index, 1);
      return this.save();
    }
    return Promise.resolve(this);
  };

  Transaction.prototype.hasTag = function(tag) {
    return this.tags.includes(tag);
  };

  Transaction.prototype.getFormattedAmount = function() {
    if (!this.amount) return '0';
    
    if (this.currency === 'XRP') {
      return `${this.amount} XRP`;
    } else if (this.currency) {
      return `${this.amount} ${this.currency}`;
    }
    
    return this.amount.toString();
  };

  // Class methods
  Transaction.findByHash = function(transactionHash) {
    return this.findOne({
      where: { transaction_hash: transactionHash }
    });
  };

  Transaction.findByUser = function(userAddress, options = {}) {
    return this.findAll({
      where: {
        [sequelize.Sequelize.Op.or]: [
          { from_address: userAddress },
          { to_address: userAddress }
        ]
      },
      order: [['created_at', 'DESC']],
      ...options
    });
  };

  Transaction.findBySwap = function(swapId, options = {}) {
    return this.findAll({
      where: { swap_id: swapId },
      order: [['created_at', 'ASC']],
      ...options
    });
  };

  Transaction.findByStatus = function(status, options = {}) {
    return this.findAll({
      where: { status },
      order: [['created_at', 'DESC']],
      ...options
    });
  };

  Transaction.findByType = function(transactionType, options = {}) {
    return this.findAll({
      where: { transaction_type: transactionType },
      order: [['created_at', 'DESC']],
      ...options
    });
  };

  Transaction.findPendingTransactions = function(options = {}) {
    return this.findAll({
      where: { 
        status: ['pending', 'submitted'],
        retry_count: {
          [sequelize.Sequelize.Op.lt]: sequelize.col('max_retries')
        }
      },
      order: [['created_at', 'ASC']],
      ...options
    });
  };

  Transaction.findStaleTransactions = function(staleMinutes = 30, options = {}) {
    const staleTime = new Date(Date.now() - staleMinutes * 60 * 1000);
    
    return this.findAll({
      where: {
        status: 'submitted',
        submitted_at: {
          [sequelize.Sequelize.Op.lt]: staleTime
        }
      },
      ...options
    });
  };

  Transaction.getStatistics = async function() {
    const totalTransactions = await this.count();
    const pendingTransactions = await this.count({ 
      where: { status: ['pending', 'submitted'] }
    });
    const validatedTransactions = await this.count({ 
      where: { status: 'validated' }
    });
    const failedTransactions = await this.count({ 
      where: { status: ['failed', 'cancelled'] }
    });
    
    const totalVolume = await this.sum('amount', {
      where: { 
        status: 'validated',
        amount: { [sequelize.Sequelize.Op.ne]: null }
      }
    });
    
    const totalFees = await this.sum('fee', {
      where: { status: 'validated' }
    });

    const typeBreakdown = await this.findAll({
      attributes: [
        'transaction_type',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count']
      ],
      group: ['transaction_type'],
      raw: true
    });

    const avgExecutionTime = await this.findAll({
      attributes: [
        [sequelize.fn('AVG', 
          sequelize.literal('EXTRACT(EPOCH FROM (validated_at - submitted_at)) * 1000')
        ), 'avg_time']
      ],
      where: {
        status: 'validated',
        submitted_at: { [sequelize.Sequelize.Op.ne]: null },
        validated_at: { [sequelize.Sequelize.Op.ne]: null }
      },
      raw: true
    });

    return {
      totalTransactions,
      pendingTransactions,
      validatedTransactions,
      failedTransactions,
      successRate: totalTransactions > 0 ? (validatedTransactions / totalTransactions) * 100 : 0,
      totalVolume: totalVolume || 0,
      totalFees: totalFees || 0,
      avgExecutionTime: avgExecutionTime[0]?.avg_time || 0,
      typeBreakdown: typeBreakdown.reduce((acc, type) => {
        acc[type.transaction_type] = parseInt(type.count);
        return acc;
      }, {})
    };
  };

  Transaction.cleanupOldTransactions = async function(daysOld = 90) {
    const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
    
    const deletedCount = await this.destroy({
      where: {
        status: ['validated', 'failed', 'cancelled'],
        created_at: {
          [sequelize.Sequelize.Op.lt]: cutoffDate
        }
      }
    });
    
    return deletedCount;
  };

  // Associations
  Transaction.associate = function(models) {
    Transaction.belongsTo(models.Swap, {
      foreignKey: 'swap_id',
      as: 'swap'
    });

    Transaction.belongsTo(models.RWAToken, {
      foreignKey: 'rwa_token_id',
      as: 'rwa_token'
    });

    Transaction.belongsTo(models.User, {
      foreignKey: 'user_id',
      as: 'user'
    });
  };

  return Transaction;
};