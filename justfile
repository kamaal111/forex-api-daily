start-db:
    gcloud emulators firestore start
run-dev:
    #!/bin/sh

    export GCP_PROJECT_ID=forex-api-daily

    python3 -c 'import daily; daily.main()'
