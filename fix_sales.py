import re

with open(r"E:\antigravty\billing softwere\pos-app\src\main\services\sales.ts", "r", encoding="utf-8") as f:
    lines = f.readlines()

# Find the start and end of the listSales function
start_idx = None
end_idx = None
for i, line in enumerate(lines):
    if 'export function listSales(from' in line and 'includeVoided = false' in line:
        start_idx = i
        break

if start_idx is not None:
    brace_count = 0
    for i in range(start_idx, len(lines)):
        brace_count += lines[i].count('{')
        brace_count -= lines[i].count('}')
        if brace_count == 0:
            end_idx = i
            break

print(f"Found function at lines {start_idx+1} to {end_idx+1}")

# Build new function
new_func_lines = [
    "export function listSales(\n",
    "  from?: string,\n",
    "  to?: string,\n",
    "  includeVoided = false,\n",
    "  customerId?: number,\n",
    "  userId?: number,\n",
    "  paymentMode?: string,\n",
    "  productId?: number,\n",
    "  minAmount?: number,\n",
    "  maxAmount?: number,\n",
    "  saleNo?: string,\n",
    "  sortBy?: 'date' | 'amount' | 'saleNo',\n",
    "  sortOrder?: 'asc' | 'desc',\n",
    "  onlyMySales?: boolean,\n",
    "  status?: 'completed' | 'voided' | 'held'\n",
    "): Sale[] {\n",
    "  const db = getDb();\n",
    "  let sql = `\n",
    "    SELECT s.*, c.name AS customer_name, u.username AS cashier_name\n",
    "    FROM sales s\n",
    "    LEFT JOIN customers c ON c.id = s.customer_id\n",
    "    LEFT JOIN users u ON u.id = s.user_id\n",
    "    WHERE 1=1\n",
    "  `;\n",
    "  const params: (string | number)[] = [];\n",
    "  \n",
    "  if (status === 'held') {\n",
    "    sql = `\n",
    "      SELECT hb.*, c.name AS customer_name, u.username AS cashier_name\n",
    "      FROM held_bills hb\n",
    "      LEFT JOIN customers c ON c.id = hb.customer_id\n",
    "      LEFT JOIN users u ON u.id = hb.user_id\n",
    "      WHERE 1=1\n",
    "    `;\n",
    "  } else {\n",
    "    if (!includeVoided && status !== 'voided') {\n",
    "      sql += \" AND s.status != 'voided'\";\n",
    "    }\n",
    "    if (status === 'voided') {\n",
    "      sql += \" AND s.status = 'voided'\";\n",
    "    }\n",
    "  }\n",
    "  \n",
    "  if (from) {\n",
    "    sql += ' AND date(s.created_at) >= date(?)';\n",
    "    params.push(from);\n",
    "  }\n",
    "  if (to) {\n",
    "    sql += ' AND date(s.created_at) <= date(?)';\n",
    "    params.push(to);\n",
    "  }\n",
    "  if (customerId) {\n",
    "    sql += ' AND s.customer_id = ?';\n",
    "    params.push(customerId);\n",
    "  }\n",
    "  if (userId) {\n",
    "    sql += ' AND s.user_id = ?';\n",
    "    params.push(userId);\n",
    "  }\n",
    "  if (paymentMode) {\n",
    "    sql += ` AND EXISTS (\n",
    "      SELECT 1 FROM payments p WHERE p.sale_id = s.id AND p.mode = ?\n",
    "    )`;\n",
    "    params.push(paymentMode);\n",
    "  }\n",
    "  if (productId) {\n",
    "    sql += ` AND EXISTS (\n",
    "      SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.product_id = ?\n",
    "    )`;\n",
    "    params.push(productId);\n",
    "  }\n",
    "  if (minAmount !== undefined) {\n",
    "    sql += ' AND s.total_amount >= ?';\n",
    "    params.push(minAmount);\n",
    "  }\n",
    "  if (maxAmount !== undefined) {\n",
    "    sql += ' AND s.total_amount <= ?';\n",
    "    params.push(maxAmount);\n",
    "  }\n",
    "  if (saleNo) {\n",
    "    sql += ' AND s.invoice_no LIKE ?';\n",
    "    params.push(`%${saleNo}%`);\n",
    "  }\n",
    "  if (onlyMySales) {\n",
    "    const currentUserId = getSessionUserId();\n",
    "    if (currentUserId) {\n",
    "      sql += ' AND s.user_id = ?';\n",
    "      params.push(currentUserId);\n",
    "    }\n",
    "  }\n",
    "  \n",
    "  const orderBy = sortBy === 'amount' ? 's.total_amount' : sortBy === 'saleNo' ? 's.invoice_no' : 's.created_at';\n",
    "  sql += ` ORDER BY ${orderBy} ${sortOrder?.toUpperCase() || 'DESC'}, s.id DESC LIMIT 500`;\n",
    "  \n",
    "  return db.prepare(sql).all(...params) as unknown as Sale[];\n",
    "}\n"
]

if start_idx is not None and end_idx is not None:
    # Replace the function
    new_lines = lines[:start_idx] + new_func_lines + lines[end_idx+1:]
    with open(r"E:\antigravty\billing softwere\pos-app\src\main\services\sales.ts", "w", encoding="utf-8") as f:
        f.writelines(new_lines)
    print(f"Replaced lines {start_idx+1}-{end_idx+1} with new function")
else:
    print("Function not found")