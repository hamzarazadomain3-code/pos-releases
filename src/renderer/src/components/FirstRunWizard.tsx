import { useEffect, useState } from 'react';
import { Modal } from './Modal';
import { useTranslation } from 'react-i18next';
import {
  builtinTemplates,
  defaultReceiptDesign,
  type ReceiptTemplateEntry,
  type ReceiptDesign,
} from '../../../shared/receiptDesign';

interface ShopProfile {
  shop_name: string;
  shop_name_urdu: string;
  shop_address: string;
  shop_phone: string;
  shop_whatsapp: string;
  shop_email: string;
  shop_website: string;
  shop_ntn: string;
  shop_strn: string;
  currency: string;
  currency_position: 'before' | 'after';
  date_format: string;
  language: 'en' | 'ur';
  receipt_footer: string;
  receipt_software_by: string;
  receipt_terms_text: string;
  receipt_return_policy: string;
  receipt_thank_you: string;
  receipt_show_software_credit: string;
  receipt_language: string;
  receipt_show_items_summary: string;
  receipt_show_payment_method: string;
  receipt_show_tax_on_receipt: string;
}

interface Branch {
  id: number;
  name: string;
}

interface StarterTemplate {
  id: string;
  name: string;
  description: string;
  paper: 'thermal80' | 'thermal58' | 'a4' | 'a5';
  preview: string;
}

interface FirstRunWizardProps {
  onComplete: (shopProfile: ShopProfile, selectedTemplateId: string) => void;
}

export default function FirstRunWizard({ onComplete }: FirstRunWizardProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [shopProfile, setShopProfile] = useState<ShopProfile>({
    shop_name: '',
    shop_name_urdu: '',
    shop_address: '',
    shop_phone: '',
    shop_whatsapp: '',
    shop_email: '',
    shop_website: '',
    shop_ntn: '',
    shop_strn: '',
    currency: 'Rs',
    currency_position: 'before',
    date_format: 'dd/mm/yyyy',
    language: 'en',
    receipt_footer: '',
    receipt_software_by: '',
    receipt_terms_text: '',
    receipt_return_policy: '',
    receipt_thank_you: '',
    receipt_show_software_credit: 'false',
    receipt_language: 'en',
    receipt_show_items_summary: 'true',
    receipt_show_payment_method: 'true',
    receipt_show_tax_on_receipt: 'true',
  });
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('builtin-compact-80');
  const [branches, setBranches] = useState<Array<{ id: number; name: string }>>([]);
  const [starterTemplates, setStarterTemplates] = useState<Array<{
    id: string;
    name: string;
    description: string;
    paper: 'thermal80' | 'thermal58' | 'a4' | 'a5';
    preview: string;
  }>>([]);
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string>('');

  // Check if first run is needed
  useEffect(() => {
    const firstRunDone = localStorage.getItem('first_run_complete');
    if (firstRunDone) {
      return;
    }
    loadStarterTemplates();
    loadBranches();
  }, []);

  async function loadStarterTemplates() {
    try {
      const templates = await window.api.receipt.getTemplates();
      // Map the templates to match our StarterTemplate interface
      const mapped: Array<{
        id: string;
        name: string;
        description: string;
        paper: 'thermal80' | 'thermal58' | 'a4' | 'a5';
        preview: string;
      }> = templates.map((t: any) => ({
        id: t.id,
        name: t.name,
        description: t.description || '',
        paper: t.paper || 'thermal80',
        preview: t.preview || '',
      }));
      setStarterTemplates(mapped);
    } catch (e) {
      console.error('Failed to load starter templates:', e);
    }
  }

  async function loadBranches() {
    try {
      const branchList = await window.api.branches.list();
      setBranches(branchList);
    } catch (e) {
      console.error('Failed to load branches:', e);
    }
  }

  async function updatePreview(templateId: string) {
    if (!shopProfile.shop_name.trim()) return;
    
    setLoading(true);
    try {
      // Get the template design from built-in templates
      const builtins = builtinTemplates();
      const template = builtins.find((t) => t.id === templateId);
      const design = template?.design || defaultReceiptDesign('thermal80');
      
      // Create a simple sample sale for preview
      const sample: any = {
        invoice_no: 'INV-20261015-0042',
        created_at: '2026-10-15T21:14:00Z',
        customer_name: 'Walk-in',
        customer_id: 1,
        customer_balance: 1500,
        cashier: 'admin',
        status: 'completed',
        items: [
          {
            product_name: 'Premium Bakery Rusk Family Pack (large loaf)',
            unit_name: 'Piece',
            qty: 2,
            unit_price: 250,
            discount: 0,
            tax_rate: 0,
            line_total: 500,
          },
          {
            product_name: 'Sugar',
            unit_name: 'Kilogram',
            qty: 1,
            display_qty: 0.57,
            unit_price: 190,
            discount: 0,
            tax_rate: 0,
            line_total: 108.3,
          },
          {
            product_name: 'Assorted Biscuits',
            unit_name: 'Piece',
            qty: 3,
            unit_price: 120,
            discount: 40,
            tax_rate: 0,
            line_total: 320,
          },
        ],
        subtotal: 928.3,
        discount_amount: 40,
        tax_amount: 0,
        service_charge: 0,
        freight: 0,
        total_amount: 888.3,
        paid: 888.3,
        payments: [{ mode: 'Cash', amount: 888.3 }],
        returned_amount: 0,
        branch: shopProfile.shop_name || 'Main Branch',
      };
      const html = await window.api.receipt.previewDesign(design, 'thermal80', 'sale');
      setPreviewHtml(html);
    } catch (e) {
      console.error('Preview failed:', e);
      setNotice('Preview failed: ' + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleNext() {
    if (step === 1) {
      if (!shopProfile.shop_name.trim()) {
        setNotice('Please enter a shop name');
        return;
      }
      await saveShopProfile();
      await loadStarterTemplates();
      setStep(2 as 1 | 2 | 3);
    } else if (step === 2) {
      if (!selectedTemplateId) {
        setNotice('Please select a receipt style');
        return;
      }
      setStep(3 as 1 | 2 | 3);
    } else if (step === 3) {
      await saveShopProfile();
      localStorage.setItem('first_run_complete', 'true');
      onComplete(shopProfile, selectedTemplateId);
    }
  }

  async function saveShopProfile() {
    try {
      const settings: Record<string, string> = {
        shop_name: shopProfile.shop_name,
        shop_name_urdu: shopProfile.shop_name_urdu,
        shop_address: shopProfile.shop_address,
        shop_phone: shopProfile.shop_phone,
        shop_whatsapp: shopProfile.shop_whatsapp,
        shop_email: shopProfile.shop_email,
        shop_website: shopProfile.shop_website,
        shop_ntn: shopProfile.shop_ntn,
        shop_strn: shopProfile.shop_strn,
        currency: shopProfile.currency,
        currency_position: shopProfile.currency_position,
        date_format: shopProfile.date_format,
        language: shopProfile.language,
        receipt_footer: shopProfile.receipt_footer,
        receipt_software_by: shopProfile.receipt_software_by,
        receipt_terms_text: shopProfile.receipt_terms_text,
        receipt_return_policy: shopProfile.receipt_return_policy,
        receipt_thank_you: shopProfile.receipt_thank_you,
        receipt_show_software_credit: shopProfile.receipt_show_software_credit,
        receipt_language: shopProfile.receipt_language,
        receipt_show_items_summary: shopProfile.receipt_show_items_summary,
        receipt_show_payment_method: shopProfile.receipt_show_payment_method,
        receipt_show_tax_on_receipt: shopProfile.receipt_show_tax_on_receipt,
      };

      for (const [k, v] of Object.entries(settings)) {
        if (v !== undefined && v !== '') {
          await window.api.settings.set(k, v);
        }
      }
      
      // Save selected template
      await window.api.admin.settings.set('receipt_template', selectedTemplateId);
      
      // Save branch defaults if any
      for (const branch of branches) {
        const override = shopProfile[`branch_${branch.id}` as keyof ShopProfile] as string | undefined;
        if (override) {
          // TODO: Save branch override
        }
      }
    } catch (e) {
      setNotice('Save failed: ' + (e as Error).message);
    }
  }

  function handleInputChange(key: keyof ShopProfile, value: string) {
    setShopProfile(prev => ({ ...prev, [key]: value }));
  }

  function handleBranchChange(branchId: number, value: string) {
    setShopProfile(prev => ({ ...prev, [`branch_${branchId}`]: value }));
  }

  // Starter templates for selection
  const STARTER_TEMPLATES = [
    { id: 'builtin-compact-80', name: 'Minimal 80mm', description: 'Clean, minimal receipt with essential info only', paper: 'thermal80' as const, preview: '' },
    { id: 'builtin-detailed-80', name: 'Detailed 80mm (with tax)', description: 'Full tax breakdown, item details', paper: 'thermal80' as const },
    { id: 'builtin-mini-58', name: '58mm Mini', description: 'Compact for small thermal rolls', paper: 'thermal58' as const },
    { id: 'builtin-a4-invoice', name: 'A4 Invoice', description: 'Full-page invoice for office/legal use', paper: 'a4' as const },
    { id: 'builtin-bakery', name: 'Bakery / Grocery', description: 'With best-before, savings, loyalty', paper: 'thermal80' as const },
    { id: 'builtin-pharmacy', name: 'Pharmacy / Medical', description: 'Batch & expiry, tax, unit columns', paper: 'thermal80' as const },
    { id: 'builtin-garment', name: 'Garment / Boutique', description: 'Size/color variants, tax, unit columns', paper: 'thermal80' as const },
    { id: 'builtin-a4-invoice', name: 'A4 Invoice', description: 'Full-page invoice for office/legal use', paper: 'a4' as const },
    { id: 'builtin-a4-pharmacy', name: 'A4 Invoice (Pharmacy)', description: 'With batch/expiry, tax breakdown', paper: 'a4' as const },
    { id: 'builtin-a4-garment', name: 'A4 Invoice (Garment)', description: 'With size/color, tax, unit columns', paper: 'a4' as const },
    { id: 'builtin-return-refund', name: 'Return / Refund', description: 'Refund receipt with return banner', paper: 'thermal80' as const },
  ];

  return (
    <Modal
      onClose={() => {}}
      title="Welcome to Rokar POS"
      style={{ maxWidth: 900, width: '95%', maxHeight: '95vh' }}
      label="First Run Setup"
      shortcuts={[]}
    >
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        {/* Progress Steps */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 12px 8px', borderBottom: '1px solid #e9ecef' }}>
          {[1, 2, 3].map((s) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  border: `2px solid ${step >= s ? '#007bff' : '#dee2e6'}`,
                  background: step >= s ? '#007bff' : 'transparent',
                  color: step >= s ? '#fff' : '#6c757d',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 600,
                  fontSize: 14,
                }}
              >
                {s}
              </div>
              {s < 3 && <div style={{ width: 60, height: 2, background: step > s ? '#dee2e6' : '#007bff', marginRight: 8 }} />}
            </div>
          ))}
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '16px 24px' }}>
          {notice && (
            <div className="notice" style={{ marginBottom: 16, padding: '10px 12px', background: '#fff3cd', border: '1px solid #ffe08a', borderRadius: 6 }}>
              {notice}
            </div>
          )}

          {/* Step 1: Shop Profile */}
          {step === 1 && (
            <div>
              <h2 style={{ marginBottom: 8 }}>Shop Profile</h2>
              <p className="muted small" style={{ marginBottom: 16 }}>
                Enter your shop details. This information will appear on receipts and reports.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>Shop Name *</label>
                  <input
                    value={shopProfile.shop_name}
                    onChange={(e) => handleInputChange('shop_name', e.target.value)}
                    placeholder="e.g. Ahmed General Store"
                    style={{ width: '100%' }}
                  />
                </div>

                <div className="form-group">
                  <label>Shop Name (Urdu)</label>
                  <input
                    value={shopProfile.shop_name_urdu}
                    onChange={(e) => handleInputChange('shop_name_urdu', e.target.value)}
                    placeholder="Urdu name (optional)"
                    dir="rtl"
                  />
                </div>

                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>Address</label>
                  <textarea
                    value={shopProfile.shop_address}
                    onChange={(e) => handleInputChange('shop_address', e.target.value)}
                    placeholder="Street, City, Area"
                    rows={3}
                    style={{ width: '100%' }}
                  />
                </div>

                <div className="form-group">
                  <label>Phone</label>
                  <input
                    value={shopProfile.shop_phone}
                    onChange={(e) => handleInputChange('shop_phone', e.target.value)}
                    placeholder="e.g. 0300-1234567"
                  />
                </div>

                <div className="form-group">
                  <label>WhatsApp</label>
                  <input
                    value={shopProfile.shop_whatsapp}
                    onChange={(e) => handleInputChange('shop_whatsapp', e.target.value)}
                    placeholder="e.g. 0300-1234567"
                  />
                </div>

                <div className="form-group">
                  <label>Email</label>
                  <input
                    value={shopProfile.shop_email}
                    onChange={(e) => handleInputChange('shop_email', e.target.value)}
                    placeholder="e.g. shop@example.com"
                    type="email"
                  />
                </div>

                <div className="form-group">
                  <label>Website</label>
                  <input
                    value={shopProfile.shop_website}
                    onChange={(e) => handleInputChange('shop_website', e.target.value)}
                    placeholder="e.g. www.myshop.com"
                  />
                </div>

                <div className="form-group">
                  <label>NTN</label>
                  <input
                    value={shopProfile.shop_ntn}
                    onChange={(e) => handleInputChange('shop_ntn', e.target.value)}
                    placeholder="National Tax Number"
                  />
                </div>

                <div className="form-group">
                  <label>STRN</label>
                  <input
                    value={shopProfile.shop_strn}
                    onChange={(e) => handleInputChange('shop_strn', e.target.value)}
                    placeholder="Sales Tax Registration Number"
                  />
                </div>

                <div className="form-group">
                  <label>Currency</label>
                  <select
                    value={shopProfile.currency}
                    onChange={(e) => handleInputChange('currency', e.target.value)}
                  >
                    <option value="Rs">Rs (Pakistani Rupee)</option>
                    <option value="$">$ (US Dollar)</option>
                    <option value="€">€ (Euro)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Currency Position</label>
                  <select
                    value={shopProfile.currency_position}
                    onChange={(e) => handleInputChange('currency_position', e.target.value as 'before' | 'after')}
                  >
                    <option value="before">Before amount (Rs 100)</option>
                    <option value="after">After amount (100 Rs)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Date Format</label>
                  <select
                    value={shopProfile.date_format}
                    onChange={(e) => handleInputChange('date_format', e.target.value)}
                  >
                    <option value="dd/mm/yyyy">DD/MM/YYYY</option>
                    <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                    <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Language</label>
                  <select
                    value={shopProfile.language}
                    onChange={(e) => handleInputChange('language', e.target.value as 'en' | 'ur')}
                  >
                    <option value="en">English</option>
                    <option value="ur">اردو (Urdu)</option>
                  </select>
                </div>

                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>Footer</label>
                  <textarea
                    value={shopProfile.receipt_footer}
                    onChange={(e) => handleInputChange('receipt_footer', e.target.value)}
                    placeholder="e.g. Thank you for shopping with us!"
                    rows={2}
                    style={{ width: '100%' }}
                  />
                </div>

                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>Terms & Conditions</label>
                  <textarea
                    value={shopProfile.receipt_terms_text}
                    onChange={(e) => handleInputChange('receipt_terms_text', e.target.value)}
                    placeholder="Terms & conditions (optional)"
                    rows={2}
                    style={{ width: '100%' }}
                  />
                </div>

                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>Return Policy</label>
                  <textarea
                    value={shopProfile.receipt_return_policy}
                    onChange={(e) => handleInputChange('receipt_return_policy', e.target.value)}
                    placeholder="Return policy (optional)"
                    rows={2}
                    style={{ width: '100%' }}
                  />
                </div>

                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>Thank You Message</label>
                  <textarea
                    value={shopProfile.receipt_thank_you}
                    onChange={(e) => handleInputChange('receipt_thank_you', e.target.value)}
                    placeholder="Thank you message (optional)"
                    rows={2}
                    style={{ width: '100%' }}
                  />
                </div>

                {branches.length > 0 && (
                  <div style={{ gridColumn: '1 / -1', marginTop: '8px', padding: '12px', background: '#f8f9fa', borderRadius: '6px' }}>
                    <h4 style={{ margin: '0 0 8px' }}>Branch Address Overrides</h4>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
                      {branches.map((branch) => (
                        <div key={branch.id} className="form-group">
                          <label>{branch.name} Address Override</label>
                          <input
                            value={shopProfile[`branch_${branch.id}` as keyof ShopProfile] as string || ''}
                            onChange={(e) => handleBranchChange(branch.id, e.target.value)}
                            placeholder={`Address override for ${branch.name}`}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 2: Choose Receipt Style */}
          {step === 2 && (
            <div>
              <h2 style={{ marginBottom: 8 }}>Choose a Receipt Style</h2>
              <p className="muted small" style={{ marginBottom: 16 }}>
                Pick a starter template. You can preview each one with your shop details and customize later.
              </p>

              {/* Live Preview */}
              <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 300, maxWidth: 400 }}>
                  <div style={{ padding: 12, background: '#f8f9fa', borderRadius: 6, border: '1px solid #dee2e6', height: '100%' }}>
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>Live Preview</div>
                    <div style={{ border: '1px solid #dee2e6', borderRadius: 4, overflow: 'hidden', background: '#fff' }}>
                      <iframe
                        title="Receipt preview"
                        srcDoc={previewHtml}
                        style={{
                          width: '100%',
                          height: 400,
                          border: 'none',
                          transform: 'scale(0.8)',
                          transformOrigin: 'top left',
                        }}
                      />
                    </div>
                    {loading && <div className="muted small" style={{ marginTop: 8, textAlign: 'center' }}>Generating preview...</div>}
                  </div>
                </div>

                {/* Template Gallery */}
                <div style={{ flex: 1, minWidth: 300 }}>
                  <h3 style={{ marginBottom: 12 }}>Choose a Template</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, maxHeight: 500, overflow: 'auto' }}>
                    {STARTER_TEMPLATES.map((tmpl) => (
                      <div
                        key={tmpl.id}
                        onClick={() => {
                          setSelectedTemplateId(tmpl.id);
                          updatePreview(tmpl.id);
                        }}
                        style={{
                          border: `2px solid ${selectedTemplateId === tmpl.id ? '#007bff' : '#dee2e6'}`,
                          borderRadius: 8,
                          padding: 12,
                          cursor: 'pointer',
                          background: selectedTemplateId === tmpl.id ? '#e7f1ff' : '#fff',
                          transition: 'all 0.2s',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; }}
                      >
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>{tmpl.name}</div>
                        <div className="muted small" style={{ fontSize: 12, marginBottom: 8 }}>{tmpl.description}</div>
                        <span className="muted small">{tmpl.paper}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 3: Confirmation */}
          {step === 3 && (
            <div style={{ textAlign: 'center', padding: '32px 16px' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>✓</div>
              <h2 style={{ marginBottom: 8 }}>All Set!</h2>
              <p className="muted" style={{ marginBottom: 24, maxWidth: 400, margin: '0 auto 24px' }}>
                Your shop is ready. You can always change the template later in Settings → Receipt Designer.
              </p>
              <div style={{ display: 'inline-flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
                <button className="btn btn-primary btn-lg" onClick={() => setStep(2 as 1 | 2 | 3)}>
                  Change Template
                </button>
                <button className="btn btn-primary btn-lg" onClick={handleNext} disabled={loading}>
                  Finish & Start Selling
                </button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, paddingTop: 16, borderTop: '1px solid #e9ecef' }}>
            {step > 1 && (
              <button className="btn" onClick={() => setStep((step - 1) as 1 | 2 | 3)} disabled={loading}>
                ← Back
              </button>
            )}
            <div style={{ flex: 1 }} />
            {step < 3 && (
              <button className="btn btn-primary" onClick={handleNext} disabled={loading}>
                Next →
              </button>
            )}
            {step === 3 && (
              <button className="btn btn-primary btn-lg" onClick={handleNext} disabled={loading}>
                Finish & Start Selling
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}