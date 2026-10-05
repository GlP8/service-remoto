import { pool } from '../../infrastructure/database/pool.js';

type ComputerRecord = {
  id: number;
  userId: number;
  os: string;
  ram: string;
  storageFree: string;
  rustdeskId: string;
  status: 'ONLINE' | 'OFFLINE';
};

export async function createComputer(
  userId: number,
  computer: Omit<ComputerRecord, 'id' | 'userId' | 'status'> & { status?: ComputerRecord['status'] },
) {
  const result = await pool.query<ComputerRecord>(
    `INSERT INTO computer ("userId", os, ram, "storageFree", "rustdeskId", status)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, "userId", os, ram, "storageFree", "rustdeskId", status`,
    [userId, computer.os, computer.ram, computer.storageFree, computer.rustdeskId, computer.status ?? 'OFFLINE'],
  );
  return result.rows[0];
}

export async function listComputers(userId: number) {
  const result = await pool.query<ComputerRecord>(
    `SELECT id, "userId", os, ram, "storageFree", "rustdeskId", status
     FROM computer WHERE "userId" = $1 ORDER BY id DESC`,
    [userId],
  );
  return result.rows;
}

export async function updateComputerStatus(userId: number, computerId: number, status: ComputerRecord['status']) {
  const result = await pool.query<ComputerRecord>(
    `UPDATE computer SET status = $3
     WHERE id = $1 AND "userId" = $2
     RETURNING id, "userId", os, ram, "storageFree", "rustdeskId", status`,
    [computerId, userId, status],
  );
  return result.rows[0] ?? null;
}
