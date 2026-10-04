# VPS MongoDB

This Compose stack runs MongoDB for the Mawee app on the same VPS. It joins the
app's `mawee_edge` Docker network, publishes no host ports, enables
authentication, and keeps database files in the named `mawee_mongo_data`
volume.

## Configure and start

Create the secret environment file next to `compose.yml`:

```sh
cp ops/mongodb/.env.example ops/mongodb/.env
```

Replace the root and app passwords with different random values. For example,
generate each one with `openssl rand -hex 32`. Keep `ops/mongodb/.env` out of
Git; it contains credentials.

The app network must exist before starting this stack. On the VPS, the main
Compose project creates `mawee_edge`. Then run:

```sh
docker compose -f ops/mongodb/compose.yml up -d
```

The init script creates `mawee_app` with `readWrite` access only to the `mawee`
database. MongoDB's init scripts run only when the data volume is empty. If the
database is already initialized, changing `.env` does not change database
users or passwords.

## Connect the app

Set the GitHub Actions `MONGODB_URI` secret to connect with username
`mawee_app`, the app password from `ops/mongodb/.env`, host `mawee-mongodb`,
port `27017`, and database `mawee`. Set `authSource` to `mawee` as well.

`mawee-mongodb` resolves inside the shared Docker network. Do not publish port
`27017` or use this URI from outside the VPS Docker network.

## Existing VPS installation

The running VPS uses `/home/ubuntu/mawee-mongo/.env` for its actual secrets and
the `mawee_mongo_data` volume for data. Keep those files and the volume when
updating the Compose configuration. Do not run `docker compose down -v` on this
stack; `-v` deletes the database volume.
