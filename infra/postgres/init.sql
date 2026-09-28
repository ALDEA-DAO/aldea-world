-- One Postgres instance for every service.
-- The ALMA Resolver uses the `alma` schema of the `aldea` database (created by its Drizzle migration).
-- Effectstream and the MUD store-indexer each create fixed schema names of their own (`effectstream`, …), so they
-- get separate databases instead of schemas (see packages/effectstream-node/SPIKE.md).
CREATE DATABASE effectstream OWNER aldea;
CREATE DATABASE mud_indexer OWNER aldea;
\connect aldea
CREATE SCHEMA IF NOT EXISTS alma AUTHORIZATION aldea;
