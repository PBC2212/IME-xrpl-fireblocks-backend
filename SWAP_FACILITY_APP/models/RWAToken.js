/**
 * RWAToken Model
 * Database model for Real World Asset tokens
 */

module.exports = (sequelize, DataTypes) => {
  const RWAToken = sequelize.define('RWAToken', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    currency_code: {
      type: DataTypes.STRING(15),
      allowNull: false,
      unique: true,
      validate: {
        len: [8, 15] // rPROP1234 format
      }
    },
    issuer_address: {
      type: DataTypes.STRING(34),
      allowNull: false,
      validate: {
        len: [25, 34]
      }
    },
    owner_address: {
      type: DataTypes.STRING(34),
      allowNull: false,
      validate: {
        len: [25, 34]
      }
    },
    asset_id: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true
    },
    asset_category: {
      type: DataTypes.ENUM('REAL_ESTATE', 'PRECIOUS_METALS', 'VEHICLES', 'COLLECTIBLES', 'EQUIPMENT'),
      allowNull: false
    },
    asset_description: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    asset_location: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    original_value: {
      type: DataTypes.DECIMAL(20, 8),
      allowNull: false,
      validate: {
        min: 0
      }
    },
    current_value: {
      type: DataTypes.DECIMAL(20, 8),
      allowNull: false,
      validate: {
        min: 0
      }
    },
    token_amount: {
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
    market_adjustment: {
      type: DataTypes.DECIMAL(6, 5),
      allowNull: false,
      defaultValue: 1.0
    },
    confidence_score: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 85,
      validate: {
        min: 0,
        max: 100
      }
    },
    status: {
      type: DataTypes.ENUM('pending', 'issued', 'active', 'swapped', 'redeemed', 'expired'),
      allowNull: false,
      defaultValue: 'pending'
    },
    oracle_validation_id: {
      type: DataTypes.UUID,
      allowNull: false
    },
    appraisal_data: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: {}
    },
    documents: {
      type: DataTypes.JSON,
      allowNull: false,
      defaultValue: []
    },
    custody_info: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {}
    },
    pledge_signature: {
      type: DataTypes.STRING(128),
      allowNull: false
    },
    issuance_transaction: {
      type: DataTypes.STRING(64),
      allowNull: true
    },
    last_valuation_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    redeemed_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {}
    }
  }, {
    tableName: 'rwa_tokens',
    timestamps: true,
    indexes: [
      {
        fields: ['currency_code'],
        unique: true
      },
      {
        fields: ['owner_address']
      },
      {
        fields: ['issuer_address']
      },
      {
        fields: ['asset_id'],
        unique: true
      },
      {
        fields: ['asset_category']
      },
      {
        fields: ['status']
      },
      {
        fields: ['oracle_validation_id']
      },
      {
        fields: ['last_valuation_at']
      },
      {
        fields: ['expires_at']
      }
    ],
    hooks: {
      beforeCreate: (token) => {
        if (!token.currency_code) {
          token.currency_code = token.generateCurrencyCode();
        }
      }
    }
  });

  // Instance methods
  RWAToken.prototype.generateCurrencyCode = function() {
    const categoryPrefixes = {
      REAL_ESTATE: 'rPROP',
      PRECIOUS_METALS: 'rMETL',
      VEHICLES: 'rVEHI',
      COLLECTIBLES: 'rCOLL',
      EQUIPMENT: 'rEQIP'
    };

    const prefix = categoryPrefixes[this.asset_category] || 'rRWA';
    const suffix = this.asset_id.slice(-4).toUpperCase();
    
    return `${prefix}${suffix}`;
  };

  RWAToken.prototype.isActive = function() {
    return ['issued', 'active'].includes(this.status);
  };

  RWAToken.prototype.isExpired = function() {
    return this.expires_at && new Date() > this.expires_at;
  };

  RWAToken.prototype.canBeSwapped = function() {
    return this.status === 'active' && !this.isExpired();
  };

  RWAToken.prototype.getCurrentSwapValue = function() {
    return this.current_value * this.discount_rate * this.market_adjustment;
  };

  RWAToken.prototype.getValueAppreciation = function() {
    if (this.original_value === 0) return 0;
    return ((this.current_value - this.original_value) / this.original_value) * 100;
  };

  RWAToken.prototype.updateValuation = function(newValue, marketAdjustment = 1.0) {
    this.current_value = newValue;
    this.market_adjustment = marketAdjustment;
    this.last_valuation_at = new Date();
    return this.save();
  };

  RWAToken.prototype.markAsSwapped = function(swapId) {
    this.status = 'swapped';
    this.metadata = {
      ...this.metadata,
      swapped_at: new Date().toISOString(),
      swap_id: swapId
    };
    return this.save();
  };

  RWAToken.prototype.markAsRedeemed = function(redemptionTx) {
    this.status = 'redeemed';
    this.redeemed_at = new Date();
    this.metadata = {
      ...this.metadata,
      redemption_transaction: redemptionTx
    };
    return this.save();
  };

  RWAToken.prototype.getDocumentsByType = function(documentType) {
    return this.documents.filter(doc => doc.type === documentType);
  };

  RWAToken.prototype.hasRequiredDocuments = function() {
    const requiredDocs = {
      REAL_ESTATE: ['deed', 'appraisal', 'insurance'],
      PRECIOUS_METALS: ['certificate', 'assay', 'storage_receipt'],
      VEHICLES: ['title', 'registration', 'inspection'],
      COLLECTIBLES: ['authenticity', 'appraisal', 'provenance'],
      EQUIPMENT: ['invoice', 'condition_report', 'maintenance_records']
    };

    const required = requiredDocs[this.asset_category] || [];
    const provided = this.documents.map(doc => doc.type);
    
    return required.every(docType => provided.includes(docType));
  };

  RWAToken.prototype.calculateConfidenceScore = function() {
    let score = 70; // Base score

    // Document quality
    if (this.hasRequiredDocuments()) score += 15;
    score += Math.min(this.documents.length * 3, 15);

    // Valuation recency
    const valuationAge = Date.now() - new Date(this.last_valuation_at).getTime();
    const daysOld = valuationAge / (1000 * 60 * 60 * 24);
    if (daysOld < 30) score += 10;
    else if (daysOld < 90) score += 5;
    else if (daysOld > 365) score -= 10;

    // Asset category reliability
    const categoryBonuses = {
      PRECIOUS_METALS: 10,
      REAL_ESTATE: 5,
      EQUIPMENT: 0,
      VEHICLES: -5,
      COLLECTIBLES: -10
    };
    score += categoryBonuses[this.asset_category] || 0;

    this.confidence_score = Math.max(0, Math.min(100, score));
    return this.confidence_score;
  };

  // Class methods
  RWAToken.findByOwner = function(ownerAddress, options = {}) {
    return this.findAll({
      where: { owner_address: ownerAddress },
      order: [['created_at', 'DESC']],
      ...options
    });
  };

  RWAToken.findByCategory = function(category, options = {}) {
    return this.findAll({
      where: { asset_category: category },
      order: [['created_at', 'DESC']],
      ...options
    });
  };

  RWAToken.findByStatus = function(status, options = {}) {
    return this.findAll({
      where: { status },
      order: [['created_at', 'DESC']],
      ...options
    });
  };

  RWAToken.findByCurrencyCode = function(currencyCode) {
    return this.findOne({
      where: { currency_code: currencyCode }
    });
  };

  RWAToken.findActiveTokens = function(options = {}) {
    return this.findAll({
      where: { 
        status: ['issued', 'active'],
        expires_at: {
          [sequelize.Sequelize.Op.or]: [
            null,
            { [sequelize.Sequelize.Op.gt]: new Date() }
          ]
        }
      },
      order: [['created_at', 'DESC']],
      ...options
    });
  };

  RWAToken.findExpiredTokens = function(options = {}) {
    return this.findAll({
      where: {
        expires_at: {
          [sequelize.Sequelize.Op.lte]: new Date()
        },
        status: { [sequelize.Sequelize.Op.ne]: 'expired' }
      },
      ...options
    });
  };

  RWAToken.getStatistics = async function() {
    const totalTokens = await this.count();
    const activeTokens = await this.count({ 
      where: { status: ['issued', 'active'] }
    });
    const swappedTokens = await this.count({ 
      where: { status: 'swapped' }
    });
    
    const totalValue = await this.sum('current_value', {
      where: { status: ['issued', 'active'] }
    });
    
    const categoryBreakdown = await this.findAll({
      attributes: [
        'asset_category',
        [sequelize.fn('COUNT', sequelize.col('id')), 'count'],
        [sequelize.fn('SUM', sequelize.col('current_value')), 'total_value']
      ],
      group: ['asset_category'],
      raw: true
    });

    const avgConfidence = await this.aggregate('confidence_score', 'AVG', {
      where: { status: ['issued', 'active'] }
    });

    return {
      totalTokens,
      activeTokens,
      swappedTokens,
      totalValue: totalValue || 0,
      avgConfidence: avgConfidence || 0,
      utilizationRate: totalTokens > 0 ? (swappedTokens / totalTokens) * 100 : 0,
      categoryBreakdown: categoryBreakdown.reduce((acc, cat) => {
        acc[cat.asset_category] = {
          count: parseInt(cat.count),
          total_value: parseFloat(cat.total_value) || 0
        };
        return acc;
      }, {})
    };
  };

  RWAToken.markExpiredTokens = async function() {
    const expiredCount = await this.update(
      { status: 'expired' },
      {
        where: {
          expires_at: {
            [sequelize.Sequelize.Op.lte]: new Date()
          },
          status: { [sequelize.Sequelize.Op.ne]: 'expired' }
        }
      }
    );
    
    return expiredCount[0]; // Number of affected rows
  };

  // Associations
  RWAToken.associate = function(models) {
    RWAToken.belongsTo(models.User, {
      foreignKey: 'owner_address',
      targetKey: 'xrpl_address',
      as: 'owner'
    });

    RWAToken.hasMany(models.Swap, {
      foreignKey: 'rwa_token_currency',
      sourceKey: 'currency_code',
      as: 'swaps'
    });

    RWAToken.hasMany(models.Transaction, {
      foreignKey: 'rwa_token_id',
      as: 'transactions'
    });
  };

  return RWAToken;
};