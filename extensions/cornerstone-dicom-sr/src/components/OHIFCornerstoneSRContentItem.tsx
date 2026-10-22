import PropTypes from 'prop-types';
import React, { useEffect, useState } from 'react';
import { CodeNameCodeSequenceValues } from '../enums';
import formatContentItemValue from '../utils/formatContentItem';
import { BulkDataValue, decodeTextValue, isBulkDataValue } from '../utils/textValue';

const EMPTY_TAG_VALUE = '[empty]';
const LOADING_TAG_VALUE = '[loading…]';
const UNAVAILABLE_TAG_VALUE = '[not available]';

/**
 * pacsai (22 Oct): a TEXT item whose value came as a bulk data reference
 * (utils/textValue.ts): its text, fetched once and decoded; a placeholder until
 * then, and if it cannot be fetched. Undefined for every other item.
 */
function useBulkDataText(contentItem): string | undefined {
  const value: BulkDataValue | null =
    contentItem.ValueType === 'TEXT' && isBulkDataValue(contentItem.TextValue)
      ? contentItem.TextValue
      : null;
  const [loaded, setLoaded] = useState<{ value: BulkDataValue; text: string } | null>(null);

  useEffect(() => {
    if (!value) {
      return;
    }
    let live = true;
    const done = (text: string) => live && setLoaded({ value, text });
    if (typeof value.Value?.byteLength === 'number') {
      done(decodeTextValue(value.Value));
    } else {
      Promise.resolve(value.retrieveBulkData?.()).then(
        buffer => done(buffer ? decodeTextValue(buffer) : UNAVAILABLE_TAG_VALUE),
        () => done(UNAVAILABLE_TAG_VALUE)
      );
    }
    return () => {
      live = false;
    };
  }, [value]);

  if (!value) {
    return undefined;
  }
  return loaded?.value === value ? loaded.text : LOADING_TAG_VALUE;
}

function OHIFCornerstoneSRContentItem(props) {
  const { contentItem, nodeIndexesTree, continuityOfContent } = props;
  const { ConceptNameCodeSequence } = contentItem;
  const { CodeValue, CodeMeaning } = ConceptNameCodeSequence;
  const isChildFirstNode = nodeIndexesTree[nodeIndexesTree.length - 1] === 0;
  const bulkDataText = useBulkDataText(contentItem);
  const formattedValue = bulkDataText ?? formatContentItemValue(contentItem) ?? EMPTY_TAG_VALUE;
  const startWithAlphaNumCharRegEx = /^[a-zA-Z0-9]/;
  const isContinuous = continuityOfContent === 'CONTINUOUS';
  const isFinding = CodeValue === CodeNameCodeSequenceValues.Finding;
  const addExtraSpace =
    isContinuous && !isChildFirstNode && startWithAlphaNumCharRegEx.test(formattedValue?.[0]);

  // Collapse sequences of white space preserving newline characters
  let className = 'whitespace-pre-line';

  if (CodeValue === CodeNameCodeSequenceValues.Finding) {
    // Preserve spaces because it is common to see tabular text in a
    // "Findings" ConceptNameCodeSequence
    className = 'whitespace-pre-wrap';
  }

  if (isContinuous) {
    return (
      <>
        <span
          className={className}
          title={CodeMeaning}
        >
          {addExtraSpace ? ' ' : ''}
          {formattedValue}
        </span>
      </>
    );
  }

  return (
    <>
      <div className="mb-2">
        <span className="font-bold">{CodeMeaning}: </span>
        {isFinding ? (
          <pre>{formattedValue}</pre>
        ) : (
          <span className={className}>{formattedValue}</span>
        )}
      </div>
    </>
  );
}

OHIFCornerstoneSRContentItem.propTypes = {
  contentItem: PropTypes.object,
  nodeIndexesTree: PropTypes.arrayOf(PropTypes.number),
  continuityOfContent: PropTypes.string,
};

export { OHIFCornerstoneSRContentItem };
