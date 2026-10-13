-- Keep the delivery details submitted at checkout as an immutable order snapshot.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS recipient_name VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS recipient_phone VARCHAR(20);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_city VARCHAR(100);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address VARCHAR(255);
