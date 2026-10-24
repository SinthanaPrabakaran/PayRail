#!/bin/bash
set -e

echo "Waiting for MongoDB to be ready on mongodb:27017..."
until mongosh --host mongodb --port 27017 --quiet --eval "db.adminCommand('ping')" > /dev/null 2>&1; do
  sleep 1
done

echo "MongoDB is up. Checking replica set status..."
RS_STATUS=$(mongosh --host mongodb --port 27017 --quiet --eval "try { rs.status().ok } catch(e) { 0 }")

if [ "$RS_STATUS" = "1" ]; then
  echo "Replica set rs0 is already initialized and active."
else
  echo "Initializing replica set rs0..."
  mongosh --host mongodb --port 27017 --quiet --eval '
    try {
      rs.initiate({
        _id: "rs0",
        members: [{ _id: 0, host: "mongodb:27017" }]
      });
      print("rs.initiate() called successfully.");
    } catch(e) {
      print("Error calling rs.initiate: " + e);
    }
  '
fi

echo "Waiting for replica set primary election..."
until mongosh --host mongodb --port 27017 --quiet --eval "try { rs.isMaster().ismaster || rs.hello().isWritablePrimary } catch(e) { false }" | grep -q 'true'; do
  sleep 1
done

echo "MongoDB Replica Set rs0 is ready and PRIMARY is elected."
