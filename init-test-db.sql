SELECT 'CREATE DATABASE iwillbethere_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'iwillbethere_test')\gexec
