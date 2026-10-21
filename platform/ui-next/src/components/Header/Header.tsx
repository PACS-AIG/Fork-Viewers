import React, { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  Icons,
  Button,
} from '../';

import NavBar from '../NavBar';

// Todo: we should move this component to composition and remove props base

interface HeaderProps {
  children?: ReactNode;
  menuOptions: Array<{
    title: string;
    icon?: string;
    onClick: () => void;
  }>;
  isReturnEnabled?: boolean;
  onClickReturnButton?: () => void;
  /** False drops the logo; with no return button the whole left mark goes (an embedded viewer). */
  showLogo?: boolean;
  /** 'start' puts the tools at the left edge (an embedded viewer, which has no logo there). */
  toolbarAlign?: 'center' | 'start';
  /** True lets the patient info give way (shrink, its lines cut) when the row is too narrow, rather than push the row past the window. */
  patientInfoShrinks?: boolean;
  isSticky?: boolean;
  WhiteLabeling?: {
    createLogoComponentFn?: (React: any, props: any) => ReactNode;
  };
  PatientInfo?: ReactNode;
  Secondary?: ReactNode;
}

function Header({
  children,
  menuOptions,
  isReturnEnabled = true,
  onClickReturnButton,
  showLogo = true,
  toolbarAlign = 'center',
  patientInfoShrinks = false,
  isSticky = false,
  WhiteLabeling,
  PatientInfo,
  Secondary,
  ...props
}: HeaderProps): ReactNode {
  const { t } = useTranslation('Header');

  const onClickReturn = () => {
    if (isReturnEnabled && onClickReturnButton) {
      onClickReturnButton();
    }
  };

  return (
    <NavBar
      isSticky={isSticky}
      {...props}
    >
      {/* In-flow flex layout (was four absolutely-positioned blocks): the
          centered toolbar could slide under the right-side patient chip on
          narrower windows since absolute siblings don't constrain each other.
          Now the toolbar zone is the flexible one (flex-1, min-w-0, scrolls
          when genuinely too tight) and left/right zones stay in flow, so
          overlap is impossible. Trade-off: the toolbar centers within the
          remaining space rather than the exact viewport center. */}
      <div className="flex h-[48px] items-center">
        <div className="flex shrink-0 items-center">
          {(isReturnEnabled || showLogo) && (
            <div
              className={classNames(
                'mr-3 inline-flex items-center',
                isReturnEnabled && 'cursor-pointer'
              )}
              onClick={onClickReturn}
              data-cy="return-to-work-list"
            >
              {isReturnEnabled && <Icons.ArrowLeft className="text-primary-active w-8" />}
              {showLogo && (
                <div className="ml-1">
                  {WhiteLabeling?.createLogoComponentFn?.(React, props) || <Icons.OHIFLogo />}
                </div>
              )}
            </div>
          )}
          {Secondary ? (
            <div className={classNames('h-8', isReturnEnabled || showLogo ? 'ml-6' : 'ml-1')}>
              {Secondary}
            </div>
          ) : null}
        </div>
        <div
          className={classNames(
            'flex min-w-0 flex-1 items-center px-2',
            toolbarAlign === 'start' ? 'justify-start' : 'justify-center'
          )}
        >
          {/* `safe center`: when the tools overflow they scroll from the first
              one; plain centering clipped the first tools off the left edge,
              out of the scroll's reach. */}
          <div
            className={classNames(
              'flex items-center space-x-2 overflow-x-auto',
              toolbarAlign === 'start' ? 'justify-start' : '[justify-content:safe_center]'
            )}
          >
            {children}
          </div>
        </div>
        <div
          className={classNames(
            'flex',
            patientInfoShrinks ? 'min-w-0' : 'shrink-0',
            'select-none items-center'
          )}
        >
          {PatientInfo}
          <div className="border-primary-dark mx-1.5 h-[25px] border-r"></div>
          <div className="flex-shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-primary-active hover:bg-primary-dark mt-2 h-full w-full"
                >
                  <Icons.GearSettings />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {menuOptions.map((option, index) => {
                  const IconComponent = option.icon
                    ? Icons[option.icon as keyof typeof Icons]
                    : null;
                  return (
                    <DropdownMenuItem
                      key={index}
                      onSelect={option.onClick}
                      className="flex items-center gap-2 py-2"
                    >
                      {IconComponent && (
                        <span className="flex h-4 w-4 items-center justify-center">
                          <Icons.ByName name={IconComponent.name} />
                        </span>
                      )}
                      <span className="flex-1">{option.title}</span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </NavBar>
  );
}

export default Header;
