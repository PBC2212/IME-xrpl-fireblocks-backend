console.log('🚀 Loading Enhanced XRPL Platform...');

// Enhanced wallet creation with detailed response
window.createWallet = async function() {
    showNotification('info', 'Creating Wallet', 'Generating new XRPL wallet...');
    
    try {
        const response = await fetch('/api/native/create-wallet', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: 'user_' + Date.now(),
                walletName: 'New Wallet ' + new Date().toLocaleString()
            })
        });
        
        const data = await response.json();
        
        console.log('✅ Wallet Response:', data);
        
        if (data.success && data.data) {
            const wallet = data.data;
            
            // Show detailed wallet information
            showWalletDetails(wallet);
            
            showNotification('success', 'Wallet Created!', 'XRPL wallet created successfully - check details below');
            console.log('✅ Wallet created:', wallet);
        } else {
            throw new Error(data.message || 'Failed to create wallet');
        }
    } catch (error) {
        showNotification('error', 'Creation Failed', error.message);
        console.error('❌ Wallet creation failed:', error);
    }
};

// Enhanced asset tokenization with transaction details
window.tokenizeAsset = async function() {
    // Create a more user-friendly form
    const modal = createFormModal('Tokenize Real-World Asset', `
        <div style="margin: 20px 0;">
            <label style="display: block; margin-bottom: 5px; font-weight: 600;">Wallet Address:</label>
            <input type="text" id="user-address" placeholder="rXXXXXXXXXXXXXXXXXXXXXXXXX" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; font-family: monospace;">
        </div>
        <div style="margin: 20px 0;">
            <label style="display: block; margin-bottom: 5px; font-weight: 600;">Asset Type:</label>
            <select id="asset-type" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px;">
                <option value="">Select Asset Type</option>
                <option value="Real Estate">Real Estate</option>
                <option value="Art">Art & Collectibles</option>
                <option value="Commodities">Commodities</option>
                <option value="Equipment">Equipment</option>
                <option value="Intellectual Property">Intellectual Property</option>
                <option value="Other">Other</option>
            </select>
        </div>
        <div style="margin: 20px 0;">
            <label style="display: block; margin-bottom: 5px; font-weight: 600;">Asset Value (USD):</label>
            <input type="number" id="asset-amount" placeholder="100000" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px;">
        </div>
        <div style="margin: 20px 0;">
            <label style="display: block; margin-bottom: 5px; font-weight: 600;">Asset Description:</label>
            <textarea id="asset-description" placeholder="Detailed description of your asset..." style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; min-height: 80px; resize: vertical;"></textarea>
        </div>
    `, async () => {
        const userAddress = document.getElementById('user-address').value;
        const assetType = document.getElementById('asset-type').value;
        const assetAmount = document.getElementById('asset-amount').value;
        const assetDescription = document.getElementById('asset-description').value;
        
        if (!userAddress || !assetType || !assetAmount || !assetDescription) {
            showNotification('warning', 'Missing Info', 'Please fill all fields');
            return;
        }
        
        // Close the form modal
        document.getElementById('form-modal')?.remove();
        
        showNotification('info', 'Tokenizing Asset', 'Creating tokens for your asset...');
        
        try {
            const response = await fetch('/api/native/pledge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userAddress: userAddress,
                    assetType: assetType,
                    assetAmount: assetAmount,
                    assetDescription: assetDescription
                })
            });
            
            const data = await response.json();
            
            console.log('✅ Tokenization Response:', data);
            
            if (data.success) {
                showTokenizationDetails(data.data || data, userAddress, assetType, assetAmount, assetDescription);
                showNotification('success', 'Asset Tokenized!', 'Your asset has been tokenized on XRPL');
            } else {
                throw new Error(data.message || 'Failed to tokenize asset');
            }
        } catch (error) {
            showNotification('error', 'Tokenization Failed', error.message);
            console.error('❌ Asset tokenization failed:', error);
        }
    });
};

// Enhanced trustline creation with transaction details
window.createTrustline = async function() {
    const modal = createFormModal('Create XRPL Trustline', `
        <div style="margin: 20px 0;">
            <label style="display: block; margin-bottom: 5px; font-weight: 600;">Wallet Seed:</label>
            <input type="password" id="wallet-seed" placeholder="sXXXXXXXXXXXXXXXXXXXXXXXXX" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; font-family: monospace;">
            <small style="color: #666; font-size: 12px;">Your wallet's secret seed (will be hidden)</small>
        </div>
        <div style="margin: 20px 0;">
            <label style="display: block; margin-bottom: 5px; font-weight: 600;">Currency Code:</label>
            <input type="text" id="currency" placeholder="RWA" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; text-transform: uppercase;" maxlength="3">
            <small style="color: #666; font-size: 12px;">3-character currency code (e.g., USD, RWA, etc.)</small>
        </div>
        <div style="margin: 20px 0;">
            <label style="display: block; margin-bottom: 5px; font-weight: 600;">Issuer Address:</label>
            <input type="text" id="issuer" placeholder="rXXXXXXXXXXXXXXXXXXXXXXXXX" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; font-family: monospace;">
        </div>
        <div style="margin: 20px 0;">
            <label style="display: block; margin-bottom: 5px; font-weight: 600;">Trust Limit:</label>
            <input type="number" id="limit" placeholder="1000000" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px;">
            <small style="color: #666; font-size: 12px;">Maximum amount you're willing to hold</small>
        </div>
    `, async () => {
        const walletSeed = document.getElementById('wallet-seed').value;
        const currency = document.getElementById('currency').value;
        const issuer = document.getElementById('issuer').value;
        const limit = document.getElementById('limit').value;
        
        if (!walletSeed || !currency || !issuer || !limit) {
            showNotification('warning', 'Missing Info', 'Please fill all fields');
            return;
        }
        
        // Close the form modal
        document.getElementById('form-modal')?.remove();
        
        showNotification('info', 'Creating Trustline', 'Setting up trustline on XRPL...');
        
        try {
            const response = await fetch('/api/native/create-trustline', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    walletSeed: walletSeed,
                    currency: currency.toUpperCase(),
                    issuer: issuer,
                    limit: limit
                })
            });
            
            const data = await response.json();
            
            console.log('✅ Trustline Response:', data);
            
            if (data.success) {
                showTrustlineDetails(data.data || data, currency, issuer, limit);
                showNotification('success', 'Trustline Created!', 'Trustline established on XRPL');
            } else {
                throw new Error(data.message || 'Failed to create trustline');
            }
        } catch (error) {
            showNotification('error', 'Trustline Failed', error.message);
            console.error('❌ Trustline creation failed:', error);
        }
    });
};

// Create form modal
function createFormModal(title, content, onSubmit) {
    const modal = document.createElement('div');
    modal.id = 'form-modal';
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(0,0,0,0.8); display: flex; align-items: center;
        justify-content: center; z-index: 10000; animation: fadeIn 0.3s ease;
    `;
    
    modal.innerHTML = `
        <div style="background: white; border-radius: 12px; max-width: 500px; max-height: 80vh; overflow-y: auto; margin: 20px; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
            <div style="padding: 20px; border-bottom: 1px solid #e2e8f0; background: linear-gradient(135deg, #1a365d, #2c5282); color: white; border-radius: 12px 12px 0 0;">
                <h2 style="margin: 0; font-size: 1.3em;">${title}</h2>
            </div>
            <div style="padding: 20px;">
                ${content}
                <div style="margin-top: 30px; display: flex; gap: 10px; justify-content: flex-end;">
                    <button onclick="document.getElementById('form-modal').remove()" style="padding: 10px 20px; background: #6c757d; color: white; border: none; border-radius: 6px; cursor: pointer;">
                        Cancel
                    </button>
                    <button id="submit-btn" style="padding: 10px 20px; background: linear-gradient(135deg, #3182ce, #2c5aa0); color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                        Submit
                    </button>
                </div>
            </div>
        </div>
    `;
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
    
    document.body.appendChild(modal);
    
    // Add submit handler
    modal.querySelector('#submit-btn').addEventListener('click', onSubmit);
    
    return modal;
}

// Show detailed wallet information
function showWalletDetails(wallet) {
    const address = wallet.address;
    const seed = wallet.seed;
    
    const modal = createModal('🎉 Wallet Created Successfully!', `
        <div style="background: linear-gradient(135deg, #f8f9fa, #e9ecef); padding: 25px; border-radius: 12px; margin: 20px 0;">
            
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border: 2px solid #38a169;">
                <div style="margin: 15px 0;">
                    <strong style="color: #1a365d;">📍 Wallet Address:</strong>
                    <div style="background: #f8f9fa; padding: 15px; border-radius: 6px; font-family: 'Monaco', monospace; word-break: break-all; margin: 8px 0; border: 1px solid #dee2e6; font-size: 14px;">
                        ${address}
                    </div>
                    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                        <button onclick="copyToClipboard('${address}')" style="padding: 8px 16px; font-size: 14px; background: #3182ce; color: white; border: none; border-radius: 6px; cursor: pointer;">
                            📋 Copy Address
                        </button>
                        <a href="https://testnet.xrpl.org/accounts/${address}" target="_blank" style="padding: 8px 16px; font-size: 14px; background: #38a169; color: white; text-decoration: none; border-radius: 6px; display: inline-block;">
                            🔍 View on XRPL Explorer
                        </a>
                    </div>
                </div>
                
                <div style="margin: 20px 0; padding: 15px; background: #fff3cd; border-radius: 6px; border-left: 4px solid #ffc107;">
                    <strong style="color: #856404;">💰 Initial Balance:</strong>
                    <div style="font-size: 18px; font-weight: bold; color: #856404; margin-top: 5px;">
                        ${wallet.balance || 0} XRP
                    </div>
                </div>
            </div>
            
            <div style="background: #fff5f5; padding: 20px; border-radius: 8px; margin: 20px 0; border: 2px solid #e53e3e;">
                <strong style="color: #e53e3e; display: flex; align-items: center; gap: 8px;">
                    🔐 Secret Seed (CRITICAL - Keep Safe!)
                </strong>
                <div style="background: white; padding: 15px; border-radius: 6px; font-family: 'Monaco', monospace; word-break: break-all; margin: 10px 0; border: 2px solid #e53e3e; font-size: 14px;">
                    ${seed}
                </div>
                <button onclick="copyToClipboard('${seed}')" style="padding: 8px 16px; font-size: 14px; background: #e53e3e; color: white; border: none; border-radius: 6px; cursor: pointer; margin-bottom: 10px;">
                    📋 Copy Seed
                </button>
                <div style="color: #e53e3e; font-size: 13px; line-height: 1.4;">
                    ⚠️ <strong>IMPORTANT:</strong> This seed controls your wallet. Store it securely offline. Never share it with anyone!
                </div>
            </div>
            
            <div style="background: white; padding: 20px; border-radius: 8px; border-left: 4px solid #38a169;">
                <h4 style="color: #1a365d; margin-top: 0;">📋 Wallet Details</h4>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin: 10px 0;">
                    <div><strong>Network:</strong> ${wallet.network || 'XRPL Testnet'}</div>
                    <div><strong>Sequence:</strong> ${wallet.sequence || 'N/A'}</div>
                    <div><strong>Created:</strong> ${new Date(wallet.createdAt).toLocaleString()}</div>
                    <div><strong>User ID:</strong> ${wallet.userId || 'N/A'}</div>
                </div>
            </div>
            
            <div style="background: #e6fffa; padding: 20px; border-radius: 8px; margin-top: 20px;">
                <strong style="color: #1a365d;">🚀 Next Steps:</strong>
                <ol style="margin: 10px 0; padding-left: 25px; line-height: 1.6; color: #2d3748;">
                    <li>💾 Save your seed phrase in a secure location</li>
                    <li>💰 Fund your wallet with testnet XRP if needed</li>
                    <li>🔗 Create trustlines to accept custom tokens</li>
                    <li>🪙 Start tokenizing your real-world assets</li>
                </ol>
            </div>
        </div>
    `);
}

// Show tokenization details
function showTokenizationDetails(data, userAddress, assetType, assetAmount, assetDescription) {
    const modal = createModal('🪙 Asset Tokenization Complete', `
        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            
            <div style="background: white; padding: 20px; border-radius: 8px; border-left: 4px solid #38a169; margin: 20px 0;">
                <h4 style="color: #1a365d; margin-top: 0;">📄 Asset Information</h4>
                <div style="display: grid; gap: 10px;">
                    <div><strong>Type:</strong> ${assetType}</div>
                    <div><strong>Value:</strong> $${Number(assetAmount).toLocaleString()}</div>
                    <div><strong>Description:</strong> ${assetDescription}</div>
                </div>
            </div>
            
            ${(data.transactionHash || data.hash || data.txHash) ? `
            <div style="margin: 15px 0; background: white; padding: 15px; border-radius: 8px;">
                <strong>📝 Transaction Hash:</strong>
                <div style="background: #f8f9fa; padding: 10px; border-radius: 4px; font-family: monospace; word-break: break-all; margin: 5px 0; font-size: 14px;">
                    ${data.transactionHash || data.hash || data.txHash}
                </div>
                <a href="https://testnet.xrpl.org/transactions/${data.transactionHash || data.hash || data.txHash}" 
                   target="_blank" 
                   style="color: #3182ce; text-decoration: none; font-weight: 600; display: inline-block; margin-top: 5px;">
                    🔍 View Transaction on XRPL Explorer →
                </a>
            </div>
            ` : ''}
            
            <div style="margin: 15px 0; background: white; padding: 15px; border-radius: 8px;">
                <strong>💼 Wallet Address:</strong>
                <div style="background: #f8f9fa; padding: 10px; border-radius: 4px; font-family: monospace; word-break: break-all; margin: 5px 0; font-size: 14px;">
                    ${userAddress}
                </div>
                <a href="https://testnet.xrpl.org/accounts/${userAddress}" 
                   target="_blank" 
                   style="color: #3182ce; text-decoration: none; font-weight: 600; display: inline-block; margin-top: 5px;">
                    🔍 View Wallet on XRPL Explorer →
                </a>
            </div>
            
            <div style="margin: 20px 0; padding: 20px; background: linear-gradient(135deg, #e6fffa, #b2f5ea); border-radius: 8px; border-left: 4px solid #38a169;">
                <strong style="color: #1a365d;">✅ Asset Successfully Tokenized!</strong>
                <div style="margin: 10px 0; font-size: 14px; color: #2d3748;">
                    Your real-world asset has been converted into digital tokens on the XRPL network. You can now trade, transfer, or use these tokens in DeFi applications.
                </div>
            </div>
        </div>
    `);
}

// Show trustline details
function showTrustlineDetails(data, currency, issuer, limit) {
    const modal = createModal('🔗 Trustline Created Successfully', `
        <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            
            <div style="background: white; padding: 20px; border-radius: 8px; border-left: 4px solid #3182ce; margin: 20px 0;">
                <h4 style="color: #1a365d; margin-top: 0;">🔗 Trustline Configuration</h4>
                <div style="display: grid; gap: 10px;">
                    <div><strong>Currency:</strong> ${currency}</div>
                    <div><strong>Trust Limit:</strong> ${Number(limit).toLocaleString()}</div>
                    <div><strong>Issuer:</strong> <span style="font-family: monospace; font-size: 14px;">${issuer}</span></div>
                </div>
            </div>
            
            ${(data.transactionHash || data.hash || data.txHash) ? `
            <div style="margin: 15px 0; background: white; padding: 15px; border-radius: 8px;">
                <strong>📝 Transaction Hash:</strong>
                <div style="background: #f8f9fa; padding: 10px; border-radius: 4px; font-family: monospace; word-break: break-all; margin: 5px 0; font-size: 14px;">
                    ${data.transactionHash || data.hash || data.txHash}
                </div>
                <a href="https://testnet.xrpl.org/transactions/${data.transactionHash || data.hash || data.txHash}" 
                   target="_blank" 
                   style="color: #3182ce; text-decoration: none; font-weight: 600; display: inline-block; margin-top: 5px;">
                    🔍 View Transaction on XRPL Explorer →
                </a>
            </div>
            ` : ''}
            
            ${(data.account || data.Account) ? `
            <div style="margin: 15px 0; background: white; padding: 15px; border-radius: 8px;">
                <strong>💼 Account:</strong>
                <div style="background: #f8f9fa; padding: 10px; border-radius: 4px; font-family: monospace; word-break: break-all; margin: 5px 0; font-size: 14px;">
                    ${data.account || data.Account}
                </div>
                <a href="https://testnet.xrpl.org/accounts/${data.account || data.Account}" 
                   target="_blank" 
                   style="color: #3182ce; text-decoration: none; font-weight: 600; display: inline-block; margin-top: 5px;">
                    🔍 View Account on XRPL Explorer →
                </a>
            </div>
            ` : ''}
            
            <div style="margin: 20px 0; padding: 20px; background: linear-gradient(135deg, #e6fffa, #b2f5ea); border-radius: 8px; border-left: 4px solid #38a169;">
                <strong style="color: #1a365d;">✅ Trustline Established!</strong>
                <div style="margin: 10px 0; font-size: 14px; color: #2d3748;">
                    You can now receive and trade ${currency} tokens from the specified issuer. The trustline allows you to hold up to ${Number(limit).toLocaleString()} tokens.
                </div>
            </div>
        </div>
    `);
}

// Create modal for detailed information
function createModal(title, content) {
    const existingModal = document.getElementById('details-modal');
    if (existingModal) existingModal.remove();
    
    const modal = document.createElement('div');
    modal.id = 'details-modal';
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(0,0,0,0.8); display: flex; align-items: center;
        justify-content: center; z-index: 10000; animation: fadeIn 0.3s ease;
    `;
    
    modal.innerHTML = `
        <div style="background: white; border-radius: 16px; max-width: 700px; max-height: 85vh; overflow-y: auto; margin: 20px; box-shadow: 0 25px 80px rgba(0,0,0,0.4);">
            <div style="padding: 25px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; background: linear-gradient(135deg, #1a365d, #2c5282); color: white; border-radius: 16px 16px 0 0;">
                <h2 style="margin: 0; font-size: 1.4em; font-weight: 600;">${title}</h2>
                <button onclick="document.getElementById('details-modal').remove()" style="background: rgba(255,255,255,0.2); border: none; color: white; font-size: 24px; cursor: pointer; padding: 8px 12px; border-radius: 8px; transition: background 0.2s;" onmouseover="this.style.background='rgba(255,255,255,0.3)'" onmouseout="this.style.background='rgba(255,255,255,0.2)'">×</button>
            </div>
            <div style="padding: 0 25px 25px 25px;">${content}</div>
        </div>
    `;
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
    
    document.body.appendChild(modal);
    return modal;
}

// Copy to clipboard function
window.copyToClipboard = function(text) {
    navigator.clipboard.writeText(text).then(() => {
        showNotification('success', 'Copied!', 'Copied to clipboard successfully');
    }).catch(() => {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showNotification('success', 'Copied!', 'Copied to clipboard successfully');
    });
};

// Enhanced notification function
function showNotification(type, title, message) {
    const container = document.getElementById('notification-container');
    if (!container) {
        alert(`${title}: ${message}`);
        return;
    }
    
    const notification = document.createElement('div');
    notification.style.cssText = `
        padding: 16px; margin: 8px 0; border-radius: 8px; background: white;
        border-left: 4px solid ${type === 'success' ? '#38a169' : type === 'error' ? '#e53e3e' : type === 'warning' ? '#d69e2e' : '#3182ce'};
        box-shadow: 0 4px 20px rgba(0,0,0,0.15); color: #333; font-family: system-ui;
        position: relative; animation: slideIn 0.3s ease; max-width: 400px;
    `;
    
    notification.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px;">
            <div style="font-size: 20px;">${type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️'}</div>
            <div style="flex: 1;"><strong>${title}</strong><br><span style="font-size: 14px; opacity: 0.8;">${message}</span></div>
            <button onclick="this.parentElement.parentElement.remove()" style="background: none; border: none; font-size: 18px; cursor: pointer; opacity: 0.6; padding: 5px;">×</button>
        </div>
    `;
    
    container.appendChild(notification);
    setTimeout(() => { if (notification.parentElement) notification.remove(); }, 6000);
    console.log(`📢 ${type.toUpperCase()}: ${title} - ${message}`);
}

// Test network connection
async function testConnection() {
    try {
        const response = await fetch('/api/health');
        const data = await response.json();
        console.log('✅ Backend connected:', data);
        showNotification('success', 'Connected!', 'XRPL backend is ready');
    } catch (error) {
        console.error('❌ Connection failed:', error);
        showNotification('error', 'Connection Failed', 'Cannot reach XRPL backend');
    }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', () => {
    console.log('📄 DOM loaded');
    setTimeout(() => {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.classList.add('hidden');
    }, 1000);
    setTimeout(() => testConnection(), 1500);
});

// Add CSS for animations
const style = document.createElement('style');
style.textContent = `
@keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
`;
document.head.appendChild(style);