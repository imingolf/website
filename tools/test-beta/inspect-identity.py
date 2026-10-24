#!/usr/bin/env python3
"""OFFLINE ONLY: inspect the previous identity evidence without opening a connection."""
import argparse
import json
from pathlib import Path
import sys
from readonly_runner import inspect_identity_evidence


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence',type=Path,required=True)
    args=parser.parse_args(argv)
    try:
        print(json.dumps(inspect_identity_evidence(args.evidence),indent=2))
        return 0
    except Exception:
        # Do not echo malformed JSON, filesystem contents, private fields or exception text.
        print('FAIL: existing identity evidence missing or incompatible. No connection attempted; no raw contents printed.')
        return 1

if __name__=='__main__':sys.exit(main())
