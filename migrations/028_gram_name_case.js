exports.up = function (db) {
  // Ensure all gram unit names are capitalised consistently as "Gram"
  db.exec(`
    UPDATE product_units
    SET name = 'Gram'
    WHERE LOWER(name) = 'gram' AND name != 'Gram';
  `);
};

exports.down = function () {}