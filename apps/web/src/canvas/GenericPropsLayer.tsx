import { Fragment } from 'react';

import { useGenericProps } from '@/canvas/hooks/useGenericProps';
import { GenericPropInstance } from '@/canvas/props/GenericProp';

export default function GenericPropsLayer() {
  const props = useGenericProps();

  if (props.length === 0) {
    return null;
  }

  return (
    <Fragment>
      {props.map((prop) => (
        <GenericPropInstance key={prop.id} prop={prop} />
      ))}
    </Fragment>
  );
}
