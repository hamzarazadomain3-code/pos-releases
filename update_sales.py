import re

with open(r"E:\antigravty\billing softwere\pos-app\src\main\services\sales.ts", "r", encoding="utf-8") as f:
    content = f.read()

new_func = '''export function listSales(
  from?: string,
  to?: string,
  includeVoided = false,
  customerId?: number,
  userId?: number,
  paymentMode?: string,
  productId?: number,
  minAmount?: number,
  maxAmount?: number,
  saleNo?: string,
  sortBy?: 'date' | 'amount' | 'saleNo',
  sortOrder?: 'asc' | 'desc',
  onlyMySales?: boolean,
  status?: 'completed' | 'voided' | 'held'
): Sale[] {
  const db = getDb();
  let sql = `
    SELECT s.*, c.name AS customer_name, u.username AS cashier_name
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN users u ON u.id = s.user_id
    WHERE 1=1
  `;
  const params: (string | number)[] = [];
  
  if (status === 'held') {
    sql = `
      SELECT hb.*, c.name AS customer_name, u.username AS cashier_name
      FROM held_bills hb
      LEFT JOIN customers c ON c.id = hb.customer_id
      LEFT JOIN users u ON u.id = hb.user_id
      WHERE 1=1
    `;
  } else {
    if (!includeVoided && status !== 'voided') {
      sql += " AND s.status != 'voided'";
    }
    if (status === 'voided') {
      sql += " AND s.status = 'voided'";
    }
  }
  
  if (from) {
    sql += ' AND date(s.created_at) >= date(?)';
    params.push(from);
  }
  if (to) {
    sql += ' AND date(s.created_at) <= date(?)';
    params.push(to);
  }
  if (customerId) {
    sql += ' AND s.customer_id = ?';
    params.push(customerId);
  }
  if (userId) {
    sql += ' AND s.user_id = ?';
    params.push(userId);
  }
  if (paymentMode) {
    sql += ` AND EXISTS (
      SELECT 1 FROM payments p WHERE p.sale_id = s.id AND p.mode = ?
    )`;
    params.push(paymentMode);
  }
  if (productId) {
    sql += ` AND EXISTS (
      SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.product_id = ?
    )`;
    params.push(productId);
  }
  if (minAmount !== undefined) {
    sql += ' AND s.total_amount >= ?';
    params.push(minAmount);
  }
  if (maxAmount !== undefined) {
    sql += ' AND s.total_amount <= ?';
    params.push(maxAmount);
  }
  if (saleNo) {
    sql += ' AND s.invoice_no LIKE ?';
    params.push(`%${saleNo}%`);
  }
  if (onlyMySales) {
    const currentUserId = getSessionUserId();
    if (currentUserId) {
      sql += ' AND s.user_id = ?';
      params.push(currentUserId);
    }
  }
  
  const orderBy = sortBy === 'amount' ? 's.total_amount' : sortBy === 'saleNo' ? 's.invoice_no' : 's.created_at';
  sql += ` ORDER BY ${orderBy} ${sortOrder?.toUpperCase() || 'DESC'}, s.id DESC LIMIT 500`;
  
  return db.prepare(sql).all(...params) as unknown as Sale[];
}'''

pattern = r'export function listSales\(from\?\: string, to\?\: string, includeVoided = false\): Sale\[\] \{[\s\S]*?sql \+= \'" ORDER BY s\.id DESC LIMIT 500\";\s+return db\.prepare\(sql\)\.all\(\.\.\.params\) as unknown as Sale\[\];\s+\}'

new_content = re.sub(pattern, new_func, content, flags=re.DOTALL)

with open(r"E:\antigravty\billing softwere\pos-app\src\main\services\sales.ts", "w", encoding="utf-8") as f:
    f.write(new_content)

print("Updated listSales function")