start-db:
    gcloud emulators firestore start
run-dev:
    #!/bin/sh

    export GCP_PROJECT_ID=forex-api-daily
    export TEST=true

    node -e 'require("./index.js").main()'
