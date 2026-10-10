# Used by `sam build` (Metadata: BuildMethod: makefile). Bundles dependencies,
# the application and the supplied public datasets into the Lambda package.
build-ApiFunction build-WorkflowFunction:
	pip install -r requirements.txt -t "$(ARTIFACTS_DIR)" --quiet
	cp -r app "$(ARTIFACTS_DIR)/app"
	mkdir -p "$(ARTIFACTS_DIR)/data"
	cp -r ../data/raw "$(ARTIFACTS_DIR)/data/raw"
	cp -r ../data/reference "$(ARTIFACTS_DIR)/data/reference"
