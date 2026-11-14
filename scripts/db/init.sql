CREATE ROLE wallet_runtime_dev LOGIN PASSWORD 'dev_runtime_local_only';
CREATE ROLE wallet_migrator_dev LOGIN PASSWORD 'dev_migrator_local_only';
CREATE ROLE wallet_runtime_test LOGIN PASSWORD 'test_runtime_local_only';
CREATE ROLE wallet_migrator_test LOGIN PASSWORD 'test_migrator_local_only';
CREATE DATABASE wallet_dev OWNER wallet_migrator_dev;
CREATE DATABASE wallet_test OWNER wallet_migrator_test;
GRANT CONNECT ON DATABASE wallet_dev TO wallet_runtime_dev;
GRANT CONNECT ON DATABASE wallet_test TO wallet_runtime_test;
